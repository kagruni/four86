import { RunnableSequence } from "@langchain/core/runnables";
import { tradingPrompt } from "../prompts/system";
import { detailedTradingPrompt, formatCoinMarketData, formatPositionsDetailed } from "../prompts/detailedSystem";
import { tradeDecisionParser } from "../parsers/tradeDecision";
import { ZhipuAI } from "../models/zhipuai";
import { OpenRouterChat } from "../models/openrouter";
import { getTradingTools } from "../tools/tradingTools";
import type { DetailedCoinData } from "../../hyperliquid/detailedMarketData";

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
  config: {
    maxLeverage: number;
    maxPositionSize: number;
  }
) {
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

      // Config
      maxLeverage: () => config.maxLeverage,
      maxPositionSize: () => config.maxPositionSize,
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
