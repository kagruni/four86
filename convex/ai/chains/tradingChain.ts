import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { tradingPrompt } from "../prompts/system";
import { detailedTradingPrompt, formatCoinMarketData, formatPositionsDetailed } from "../prompts/detailedSystem";
import { compactTradingPrompt, formatPreProcessedSignals, formatPositions as formatPositionsCompact } from "../prompts/compactSystem";
import {
  alphaArenaTradingPrompt,
  formatMarketDataAlphaArena,
  formatPositionsAlphaArena,
  formatSentimentContext,
  parseAlphaArenaOutput,
  parseAlphaArenaOutputWithWarnings,
  type AlphaArenaOutput,
} from "../prompts/alphaArenaPrompt";
import { ParserWarning, createWarning } from "../parsers/parserWarnings";
import { generatePromptVariables, type BotConfig } from "../prompts/promptHelpers";
import { tradeDecisionParser } from "../parsers/tradeDecision";
import { ZhipuAI } from "../models/zhipuai";
import { OpenRouterChat } from "../models/openrouter";
import { getTradingTools } from "../tools/tradingTools";
import type { DetailedCoinData } from "../../hyperliquid/detailedMarketData";
import type { ProcessedSignals } from "../../signals/types";

export function createTradingChain(
  modelType: "zhipuai" | "openrouter",
  modelName: string,
  apiKey: string,
  config: {
    maxLeverage: number;
    maxPositionSize: number;
  }
) {
  // Select the appropriate model
  const model = modelType === "zhipuai"
    ? new ZhipuAI({ apiKey, model: modelName })
    : new OpenRouterChat({ apiKey, model: modelName });

  // Create the chain
  const chain = RunnableSequence.from([
    {
      // Format the input
      marketDataFormatted: (input: any) => formatMarketData(input.marketData),
      positionsFormatted: (input: any) => formatPositions(input.positions),
      accountValue: (input: any) => input.accountState.accountValue,
      availableCash: (input: any) => input.accountState.withdrawable,
      marginUsed: (input: any) => input.accountState.totalMarginUsed,
      positionCount: (input: any) => input.positions.length,
      timestamp: () => new Date().toISOString(),
      maxLeverage: () => config.maxLeverage,
      maxPositionSize: () => config.maxPositionSize,
    },
    tradingPrompt,
    model,
    tradeDecisionParser,
  ]);

  return chain;
}

function formatMarketData(marketData: Record<string, any>): string {
  let formatted = "";

  for (const [symbol, data] of Object.entries(marketData)) {
    formatted += `
### ${symbol}
- Price: $${data.price.toFixed(2)}
- 24h Volume: $${data.volume_24h?.toFixed(0) || 'N/A'}
- RSI: ${data.indicators.rsi.toFixed(1)} ${getRSISignal(data.indicators.rsi)}
- MACD: ${data.indicators.macd.toFixed(2)} (Signal: ${data.indicators.macd_signal.toFixed(2)})
- Trend (10min): ${data.indicators.price_change_short >= 0 ? '+' : ''}${data.indicators.price_change_short.toFixed(2)}%
- Trend (4h): ${data.indicators.price_change_medium >= 0 ? '+' : ''}${data.indicators.price_change_medium.toFixed(2)}%
`;
  }

  return formatted;
}

function formatPositions(positions: any[]): string {
  if (positions.length === 0) {
    return "\n## Current Positions\n\nNo open positions.";
  }

  let formatted = "\n## Current Positions\n";

  for (const pos of positions) {
    formatted += `
**${pos.symbol}** - ${pos.side}
- Size: $${pos.size.toFixed(2)} (${pos.leverage}x leverage)
- Entry: $${pos.entryPrice.toFixed(2)}
- Current: $${pos.currentPrice.toFixed(2)}
- P&L: $${pos.unrealizedPnl.toFixed(2)} (${pos.unrealizedPnlPct.toFixed(2)}%)
- Stop Loss: $${pos.stopLoss?.toFixed(2) || 'None'}
- Take Profit: $${pos.takeProfit?.toFixed(2) || 'None'}
`;
  }

  return formatted;
}

function getRSISignal(rsi: number): string {
  if (rsi < 30) return "(OVERSOLD)";
  if (rsi > 70) return "(OVERBOUGHT)";
  return "(NEUTRAL)";
}

/**
 * Create detailed trading chain with multi-timeframe analysis
 */
export function createDetailedTradingChain(
  modelType: "zhipuai" | "openrouter",
  modelName: string,
  apiKey: string,
  config: BotConfig
) {
  // Generate all prompt template variables from config
  const promptVars = generatePromptVariables(config);

  // Get trading tools for function calling
  const tools = getTradingTools();

  // Select the appropriate model with tool calling enabled
  const model = modelType === "zhipuai"
    ? new ZhipuAI({ apiKey, model: modelName, tools, maxTokens: 8000 }) // Increased from 2000 to prevent truncation
    : new OpenRouterChat({ apiKey, model: modelName });

  // Create the chain with detailed prompts
  const chain = RunnableSequence.from([
    {
      // Format all coins market data
      allCoinsMarketData: (input: any) => formatAllCoinsMarketData(input.detailedMarketData),

      // Format positions with detailed exit plans
      currentPositionsDetailed: (input: any) => formatPositionsDetailed(input.positions || []),

      // Format recent trading actions for context memory
      recentTradingHistory: (input: any) => formatRecentActions(input.recentActions || []),

      // Account information
      accountValue: (input: any) => input.accountState.accountValue.toFixed(2),
      availableCash: (input: any) => input.accountState.withdrawable.toFixed(2),
      marginUsed: (input: any) => input.accountState.totalMarginUsed.toFixed(2),

      // Performance metrics
      totalReturnPct: (input: any) => calculateTotalReturnPct(input),
      positionCount: (input: any) => (input.positions || []).length,

      // Session info
      timestamp: () => new Date().toISOString(),
      invocationCount: (input: any) => input.invocationCount || 0,

      // Spread all generated prompt variables
      ...Object.fromEntries(Object.entries(promptVars).map(([key, value]) => [key, () => value])),
    },
    detailedTradingPrompt,
    model,
    tradeDecisionParser,
  ]);

  return chain;
}

/**
 * Format all coins market data using the detailed format
 */
function formatAllCoinsMarketData(marketData: Record<string, DetailedCoinData>): string {
  let formatted = "";

  for (const [symbol, data] of Object.entries(marketData)) {
    formatted += formatCoinMarketData(symbol, data);
  }

  return formatted || "No market data available.";
}

/**
 * Format recent trading actions for prompt context
 * Shows last 5 OPEN/CLOSE decisions with outcomes
 */
function formatRecentActions(actions: any[]): string {
  if (!actions || actions.length === 0) {
    return "\nNo recent trading actions.";
  }

  let formatted = "\n";

  for (const action of actions) {
    const time = action.timestamp || "??:??";
    const decision = action.decision;
    const symbol = action.symbol || "UNKNOWN";
    const reasoning = action.reasoning
      ? action.reasoning.slice(0, 120) + (action.reasoning.length > 120 ? "..." : "")
      : "No reasoning provided";
    const confidence = action.confidence ? action.confidence.toFixed(2) : "0.00";

    if (decision === "OPEN_LONG" || decision === "OPEN_SHORT") {
      formatted += `[${time}] ${decision} ${symbol}\n`;
      formatted += `  Reasoning: ${reasoning}\n`;
      formatted += `  Confidence: ${confidence}`;

      // If we have P&L, it means the position was closed
      if (action.pnlPct !== null && action.pnlPct !== undefined) {
        const pnlSign = action.pnlPct >= 0 ? "+" : "";
        formatted += ` | Closed: ${pnlSign}${action.pnlPct.toFixed(1)}%`;
      } else {
        formatted += ` | Status: Open`;
      }
      formatted += `\n\n`;
    } else if (decision === "CLOSE") {
      formatted += `[${time}] CLOSE ${symbol}\n`;
      formatted += `  Exit Reason: ${reasoning}\n`;
      if (action.pnlPct !== null && action.pnlPct !== undefined) {
        const pnlSign = action.pnlPct >= 0 ? "+" : "";
        formatted += `  Result: ${pnlSign}${action.pnlPct.toFixed(1)}%`;
      }
      formatted += `\n\n`;
    }
  }

  return formatted;
}

/**
 * Calculate total return percentage
 * If initial account value is available, calculate return
 * Otherwise return 0 or estimate from current positions
 */
function calculateTotalReturnPct(input: any): string {
  // If we have initial account value in accountState
  if (input.accountState.initialAccountValue && input.accountState.initialAccountValue > 0) {
    const initial = input.accountState.initialAccountValue;
    const current = input.accountState.accountValue;
    const returnPct = ((current - initial) / initial) * 100;
    return returnPct.toFixed(2);
  }

  // If we have positions with unrealized P&L
  if (input.positions && input.positions.length > 0) {
    const totalUnrealizedPnl = input.positions.reduce((sum: number, pos: any) => {
      return sum + (pos.unrealizedPnl || 0);
    }, 0);
    const accountValue = input.accountState.accountValue;
    const estimatedInitial = accountValue - totalUnrealizedPnl;

    if (estimatedInitial > 0) {
      const returnPct = (totalUnrealizedPnl / estimatedInitial) * 100;
      return returnPct.toFixed(2);
    }
  }

  // Default: no return data available
  return "0.00";
}

// =============================================================================
// COMPACT TRADING CHAIN (Pre-processed signals)
// =============================================================================

/**
 * Configuration subset for compact chain prompt variables
 */
export interface CompactBotConfig {
  maxLeverage: number;
  maxPositionSize: number;
  perTradeRiskPct?: number;
  minEntryConfidence?: number;
  maxTotalPositions?: number;
  maxSameDirectionPositions?: number;
}

/**
 * Generate prompt template variables for compact chain
 */
function generateCompactPromptVariables(config: CompactBotConfig) {
  return {
    maxLeverage: config.maxLeverage,
    maxPositionSize: config.maxPositionSize,
    perTradeRiskPct: config.perTradeRiskPct ?? 2.0,
    minEntryConfidence: config.minEntryConfidence ?? 0.6,
    maxTotalPositions: config.maxTotalPositions ?? 3,
    maxSameDirectionPositions: config.maxSameDirectionPositions ?? 2,
  };
}

/**
 * Create compact trading chain with pre-processed signals
 *
 * This chain uses pre-calculated market signals instead of raw data,
 * reducing token usage and focusing the AI on decision-making rather
 * than technical analysis.
 */
export function createCompactTradingChain(
  modelType: "zhipuai" | "openrouter",
  modelName: string,
  apiKey: string,
  config: CompactBotConfig
) {
  // Generate prompt template variables from config
  const promptVars = generateCompactPromptVariables(config);

  // Select the appropriate model
  const model = modelType === "zhipuai"
    ? new ZhipuAI({ apiKey, model: modelName })
    : new OpenRouterChat({ apiKey, model: modelName });

  // Create the chain with compact prompts
  const chain = RunnableSequence.from([
    {
      // Pre-processed signals formatted as string
      preProcessedSignals: (input: { processedSignals: ProcessedSignals; positions?: any[]; accountState: any }) =>
        formatPreProcessedSignals(input.processedSignals.coins),

      // Format positions with invalidation checks
      currentPositions: (input: { processedSignals: ProcessedSignals; positions?: any[]; accountState: any }) =>
        formatPositionsCompact(input.positions || []),

      // Account information
      accountValue: (input: { processedSignals: ProcessedSignals; positions?: any[]; accountState: any }) =>
        input.accountState.accountValue.toFixed(2),
      availableCash: (input: { processedSignals: ProcessedSignals; positions?: any[]; accountState: any }) =>
        input.accountState.withdrawable.toFixed(2),
      positionCount: (input: { processedSignals: ProcessedSignals; positions?: any[]; accountState: any }) =>
        (input.positions || []).length,
      maxPositions: () => config.maxTotalPositions || 3,

      // Session info
      timestamp: () => new Date().toISOString(),

      // Spread all generated prompt variables
      ...Object.fromEntries(Object.entries(promptVars).map(([key, value]) => [key, () => value])),
    },
    compactTradingPrompt,
    model,
    tradeDecisionParser,
  ]);

  return chain;
}

// =============================================================================
// ALPHA ARENA TRADING CHAIN (Replicates winning strategy)
// =============================================================================

/**
 * Attempt to repair common JSON issues from LLM output:
 * - Single quotes → double quotes (but not inside already-double-quoted strings)
 * - Trailing commas before } or ]
 * - Unquoted property names
 */
function repairJson(text: string): string {
  let result = text;

  // 0. Remove literal ellipsis patterns that models sometimes add
  //    e.g. { "BTC": { "signal": "hold" }, ... } or trailing ...
  result = result.replace(/,\s*\.{3}\s*(?=[}\]])/g, ""); // , ... } or , ... ]
  result = result.replace(/,\s*…\s*(?=[}\]])/g, "");     // , … } (unicode ellipsis)
  result = result.replace(/\.{3}\s*(?=[}\]])/g, "");      // ... } without comma
  result = result.replace(/…\s*(?=[}\]])/g, "");           // … } without comma
  // Remove // comments (single-line) that some models add
  result = result.replace(/\/\/[^\n]*/g, "");
  // Remove /* ... */ comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");

  // 1. Replace single-quoted keys and values with double-quoted ones
  //    Matches: 'key' or 'value' but avoids touching apostrophes inside words
  result = result.replace(/(?<=[\s,{[\]:])'/g, '"');
  result = result.replace(/'(?=[\s,}\]:])/g, '"');

  // 2. Broader single→double quote replacement for remaining cases
  //    Only if the string still fails JSON.parse, we do a more aggressive pass
  try {
    JSON.parse(result);
    return result;
  } catch {
    // More aggressive: replace all single quotes that look like JSON delimiters
    result = text.replace(/'/g, '"');
    // Re-apply ellipsis removal after quote replacement
    result = result.replace(/,\s*\.{3}\s*(?=[}\]])/g, "");
    result = result.replace(/,\s*…\s*(?=[}\]])/g, "");
    result = result.replace(/\.{3}\s*(?=[}\]])/g, "");
    result = result.replace(/…\s*(?=[}\]])/g, "");
  }

  // 3. Remove trailing commas before } or ]
  result = result.replace(/,\s*([\]}])/g, "$1");

  // 4. Quote unquoted property names: { foo: → { "foo":
  result = result.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

  return result;
}

/**
 * Extract the first balanced JSON object from a string using bracket-depth counting.
 * Replaces the greedy regex `/\{[\s\S]*\}/` which could match across unrelated objects.
 */
function extractFirstJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.substring(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Alpha Arena-style parser that handles the multi-decision output format.
 * Uses bracket-depth JSON extraction and tracks warnings.
 * Uses RunnableLambda for proper LangChain integration.
 */
function createAlphaArenaParser() {
  return new RunnableLambda({
    func: async (input: any): Promise<any> => {
      const warnings: ParserWarning[] = [];

      // Handle if the model returned an object directly (some models do this)
      let text: string;
      if (typeof input === "object" && input !== null) {
        // Check if it's a LangChain AIMessage
        if (input.content !== undefined) {
          text = String(input.content);
        } else if (input.text !== undefined) {
          text = String(input.text);
        } else {
          // It's already a parsed object, try to use it directly
          console.log("[AlphaArena Parser] Received object input, attempting direct parse");
          try {
            const legacyDecision = parseAlphaArenaOutput(input as AlphaArenaOutput);
            return legacyDecision;
          } catch {
            text = JSON.stringify(input);
          }
        }
      } else if (typeof input === "string") {
        text = input;
      } else {
        console.error("[AlphaArena Parser] Unknown input type:", typeof input);
        return {
          decision: "HOLD",
          symbol: null,
          confidence: 0.99,
          reasoning: `Unknown input type: ${typeof input} - defaulting to HOLD`,
        };
      }

      console.log(`[AlphaArena Parser] Raw input length: ${text?.length || 0} chars`);

      // Handle empty response
      if (!text || text.trim() === "") {
        console.error("[AlphaArena Parser] Empty response from model");
        return {
          decision: "HOLD",
          symbol: null,
          confidence: 0.99,
          reasoning: "Empty response - defaulting to HOLD",
        };
      }

      // Strip markdown code blocks
      let cleanedText = text.trim();
      // Handle code fences anywhere in the text (not just at the start)
      const codeFenceMatch = cleanedText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeFenceMatch) {
        // Capture any prose text before the code fence as potential reasoning
        const preCodeText = cleanedText.substring(0, cleanedText.indexOf("```")).trim();
        cleanedText = codeFenceMatch[1].trim();
        if (preCodeText) {
          console.log(`[AlphaArena Parser] Captured ${preCodeText.length} chars of pre-JSON reasoning`);
        }
      } else if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/^```(?:json)?\s*\n?/, "");
        cleanedText = cleanedText.replace(/\n?```\s*$/, "");
        cleanedText = cleanedText.trim();
      }

      // Extract <think> tags if present (DeepSeek)
      const thinkMatch = cleanedText.match(/<think>([\s\S]*?)<\/think>/i);
      let thinking = "";
      if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        cleanedText = cleanedText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        console.log(`[AlphaArena Parser] Extracted ${thinking.length} chars from <think> tags`);
      }

      // Capture any prose text before JSON as potential reasoning
      let preJsonReasoning = "";
      if (!cleanedText.startsWith("{")) {
        const firstBrace = cleanedText.indexOf("{");
        if (firstBrace > 0) {
          preJsonReasoning = cleanedText.substring(0, firstBrace).trim();
          if (preJsonReasoning.length > 20) {
            console.log(`[AlphaArena Parser] Captured ${preJsonReasoning.length} chars of pre-JSON reasoning`);
          }
        }
        const extracted = extractFirstJsonObject(cleanedText);
        if (extracted) {
          cleanedText = extracted;
          warnings.push(
            createWarning(
              "JSON_EXTRACTION_FALLBACK",
              "JSON extracted using bracket-depth parser (content did not start with '{')"
            )
          );
        }
      }

      // Try JSON.parse, then repair + retry if it fails
      let parsed: AlphaArenaOutput;
      try {
        parsed = JSON.parse(cleanedText) as AlphaArenaOutput;
      } catch (firstError) {
        console.log("[AlphaArena Parser] Initial JSON.parse failed, attempting repair...");
        try {
          const repaired = repairJson(cleanedText);
          parsed = JSON.parse(repaired) as AlphaArenaOutput;
          warnings.push(
            createWarning(
              "JSON_EXTRACTION_FALLBACK",
              "JSON repaired (likely single quotes or trailing commas from LLM)"
            )
          );
          console.log("[AlphaArena Parser] JSON repair succeeded");
        } catch (repairError) {
          // Last resort: try extracting a JSON object from the text
          const extracted = extractFirstJsonObject(cleanedText);
          if (extracted) {
            try {
              const repaired = repairJson(extracted);
              parsed = JSON.parse(repaired) as AlphaArenaOutput;
              warnings.push(
                createWarning(
                  "JSON_EXTRACTION_FALLBACK",
                  "JSON extracted via bracket-depth + repair after parse failure"
                )
              );
              console.log("[AlphaArena Parser] Bracket extraction + repair succeeded");
            } catch {
              console.error("[AlphaArena Parser] All JSON parse attempts failed:", firstError);
              console.error("[AlphaArena Parser] Response preview:", cleanedText.slice(0, 300));
              // Use thinking or pre-JSON reasoning text if available, otherwise a clear message
              const fallbackReasoning = thinking || preJsonReasoning ||
                "AI response could not be parsed (JSON syntax error). Defaulting to HOLD for safety.";
              return {
                decision: "HOLD",
                symbol: null,
                confidence: 0.5,
                reasoning: fallbackReasoning,
              };
            }
          } else {
            console.error("[AlphaArena Parser] No JSON found in response. Preview:", cleanedText.slice(0, 300));
            const fallbackReasoning = thinking || preJsonReasoning ||
              "No structured decision found in AI response. Defaulting to HOLD for safety.";
            return {
              decision: "HOLD",
              symbol: null,
              confidence: 0.5,
              reasoning: fallbackReasoning,
            };
          }
        }
      }

      // Check if parsed.thinking is a real reasoning string or just a placeholder
      const isValidThinking = (s: string | undefined): boolean =>
        !!s && s.length > 10 && !/^\.{2,}$/.test(s.trim()) && !/^…+$/.test(s.trim());

      // Use the thinking from <think> tags, pre-JSON prose, or parsed thinking (in priority order)
      // Always prefer longer, more substantive reasoning over placeholders like "..."
      if (!isValidThinking(parsed.thinking)) {
        if (thinking && thinking.length > 10) {
          parsed.thinking = thinking;
          console.log(`[AlphaArena Parser] Using <think> tag reasoning (${thinking.length} chars)`);
        } else if (preJsonReasoning && preJsonReasoning.length > 20) {
          parsed.thinking = preJsonReasoning;
          console.log(`[AlphaArena Parser] Using pre-JSON reasoning (${preJsonReasoning.length} chars)`);
        } else {
          console.log(`[AlphaArena Parser] No valid reasoning found. parsed.thinking="${parsed.thinking}", thinking="${thinking?.slice(0, 50)}", preJson="${preJsonReasoning?.slice(0, 50)}"`);
        }
      }

      // Convert Alpha Arena format to legacy format (with highest-confidence selection)
      const { decision: legacyDecision, warnings: arenaWarnings } =
        parseAlphaArenaOutputWithWarnings(parsed);
      warnings.push(...arenaWarnings);

      // Fix leverage if < 1
      if (legacyDecision.leverage !== undefined && legacyDecision.leverage < 1) {
        warnings.push(
          createWarning(
            "LEVERAGE_CORRECTED",
            `Leverage corrected from ${legacyDecision.leverage} to 1`,
            legacyDecision.leverage,
            1
          )
        );
        console.log(`[AlphaArena Parser] Correcting leverage from ${legacyDecision.leverage} to 1`);
        legacyDecision.leverage = 1;
      }

      // Fix invalid symbols
      const validSymbols = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
      if (legacyDecision.symbol && !validSymbols.includes(legacyDecision.symbol)) {
        warnings.push(
          createWarning(
            "SYMBOL_CORRECTED",
            `Invalid symbol "${legacyDecision.symbol}" corrected to null`,
            legacyDecision.symbol,
            null
          )
        );
        console.log(`[AlphaArena Parser] Correcting invalid symbol "${legacyDecision.symbol}" to null`);
        legacyDecision.symbol = null;
        legacyDecision.decision = "HOLD";
      }

      if (warnings.length > 0) {
        console.log(`[AlphaArena Parser] ${warnings.length} warning(s): ${warnings.map(w => w.type).join(", ")}`);
      }

      // Attach warnings to decision for downstream logging
      if (warnings.length > 0) {
        (legacyDecision as any)._parserWarnings = warnings;
      }

      console.log(`[AlphaArena Parser] Decision: ${legacyDecision.decision} ${legacyDecision.symbol || ""}`);
      return legacyDecision;
    },
  });
}

/**
 * Create Alpha Arena-style trading chain
 *
 * This chain replicates the exact format used by winning AI traders:
 * - Raw market data (no pre-processed recommendations)
 * - Per-coin analysis with chain-of-thought
 * - Optimized for low-frequency, high-conviction trading
 */
export function createAlphaArenaTradingChain(
  modelType: "zhipuai" | "openrouter",
  modelName: string,
  apiKey: string,
  config: CompactBotConfig
) {
  // Generate prompt template variables from config
  const promptVars = generateCompactPromptVariables(config);

  // Select the appropriate model
  const model = modelType === "zhipuai"
    ? new ZhipuAI({ apiKey, model: modelName })
    : new OpenRouterChat({ apiKey, model: modelName });

  // Create Alpha Arena parser
  const alphaArenaParser = createAlphaArenaParser();

  // Input type for the Alpha Arena chain
  type AlphaArenaInput = {
    detailedMarketData: Record<string, DetailedCoinData>;
    positions?: any[];
    accountState: any;
    marketResearch?: any;
  };

  // Create the chain with Alpha Arena prompts
  const chain = RunnableSequence.from([
    {
      // Format market data in Alpha Arena style
      marketDataSection: (input: AlphaArenaInput) =>
        formatMarketDataAlphaArena(input.detailedMarketData),

      // Format positions in Alpha Arena style
      positionsSection: (input: AlphaArenaInput) =>
        formatPositionsAlphaArena(input.positions || []),

      // List of symbols with open positions (critical for AI to know what NOT to trade)
      openPositionSymbols: (input: AlphaArenaInput) => {
        const positions = input.positions || [];
        if (positions.length === 0) return "None - all symbols available for entry";
        return positions.map((p: any) => `${p.symbol} (${p.side})`).join(", ");
      },

      // Market sentiment context (from research loop)
      sentimentContext: (input: AlphaArenaInput) =>
        formatSentimentContext(input.marketResearch || null),

      // Account information
      accountValue: (input: AlphaArenaInput) =>
        input.accountState.accountValue.toFixed(2),
      availableCash: (input: AlphaArenaInput) =>
        input.accountState.withdrawable.toFixed(2),
      positionCount: (input: AlphaArenaInput) =>
        (input.positions || []).length,
      maxPositions: () => config.maxTotalPositions || 3,

      // Session info
      timestamp: () => new Date().toISOString(),

      // Spread all generated prompt variables
      ...Object.fromEntries(Object.entries(promptVars).map(([key, value]) => [key, () => value])),
    },
    alphaArenaTradingPrompt,
    model,
    alphaArenaParser,
  ]);

  return chain;
}
