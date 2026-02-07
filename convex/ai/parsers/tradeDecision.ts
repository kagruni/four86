import { StructuredOutputParser } from "langchain/output_parsers";
import { TradeDecisionSchema } from "./schemas";
import { ParserWarning, createWarning } from "./parserWarnings";

/**
 * Extract the first balanced JSON object from a string using bracket-depth counting.
 * Replaces the greedy regex `/\{[\s\S]*\}/` which could match too much.
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
 * Extract reasoning from <think> tags (DeepSeek R1, V3.1, Kimi K2)
 * Returns { reasoning: string | null, content: string }
 */
function extractReasoningTags(text: string): { reasoning: string | null; content: string } {
  // Match <think>...</think> tags (case insensitive, multiline)
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);

  if (thinkMatch) {
    const reasoning = thinkMatch[1].trim();
    // Remove the think tags from the content
    const content = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    console.log(`[Parser] Extracted ${reasoning.length} chars of reasoning from <think> tags`);
    return { reasoning, content };
  }

  return { reasoning: null, content: text };
}

/**
 * Attempt to repair common JSON issues from LLM output:
 * - Single quotes → double quotes
 * - Trailing commas before } or ]
 * - Unquoted property names
 */
function repairJson(text: string): string {
  let result = text;

  // Replace single quotes with double quotes
  result = result.replace(/'/g, '"');

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([\]}])/g, "$1");

  // Quote unquoted property names: { foo: → { "foo":
  result = result.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

  return result;
}

/**
 * Strip markdown code blocks and other formatting
 */
function stripMarkdownFormatting(text: string): string {
  let cleanedText = text.trim();

  // Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
  if (cleanedText.startsWith("```")) {
    cleanedText = cleanedText.replace(/^```(?:json)?\s*\n?/, "");
    cleanedText = cleanedText.replace(/\n?```\s*$/, "");
    cleanedText = cleanedText.trim();
  }

  return cleanedText;
}

const VALID_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];

/**
 * Apply leverage and symbol corrections, collecting warnings.
 */
function applyCorrections(rawParsed: any, warnings: ParserWarning[]): void {
  // Fix leverage if < 1 (perpetual futures requirement)
  if (rawParsed.leverage !== null && rawParsed.leverage !== undefined && rawParsed.leverage < 1) {
    warnings.push(
      createWarning(
        "LEVERAGE_CORRECTED",
        `Leverage corrected from ${rawParsed.leverage} to 1 (minimum for perpetual futures)`,
        rawParsed.leverage,
        1
      )
    );
    console.log(`[Parser] Correcting leverage from ${rawParsed.leverage} to 1`);
    rawParsed.leverage = 1;
  }

  // Fix invalid symbol values (AI sometimes returns "ALL", "NONE", etc.)
  if (rawParsed.symbol && !VALID_SYMBOLS.includes(rawParsed.symbol)) {
    warnings.push(
      createWarning(
        "SYMBOL_CORRECTED",
        `Invalid symbol "${rawParsed.symbol}" corrected to null`,
        rawParsed.symbol,
        null
      )
    );
    console.log(`[Parser] Correcting invalid symbol "${rawParsed.symbol}" to null`);
    rawParsed.symbol = null;
  }
}

// Custom parser that handles reasoning tags, markdown, and malformed responses
class ReasoningAwareParser extends StructuredOutputParser<typeof TradeDecisionSchema> {
  async parse(text: string): Promise<any> {
    console.log(`[Parser] Raw input length: ${text?.length || 0} chars`);

    // Handle empty response
    if (!text || text.trim() === "") {
      console.error("[Parser] Empty response from model");
      throw new Error("Empty response from model");
    }

    // First extract any reasoning from <think> tags
    const { reasoning, content } = extractReasoningTags(text);

    // Then strip markdown formatting
    let cleanedText = stripMarkdownFormatting(content);

    // Try to extract JSON if the content isn't pure JSON
    if (!cleanedText.trim().startsWith("{")) {
      console.log("[Parser] Response doesn't start with JSON, attempting extraction...");
      const extracted = extractFirstJsonObject(cleanedText);
      if (extracted) {
        cleanedText = extracted;
        console.log(`[Parser] Extracted JSON: ${cleanedText.slice(0, 100)}...`);
      } else {
        console.error("[Parser] No JSON found in response");
        throw new Error(`No JSON found in response. First 200 chars: ${cleanedText.slice(0, 200)}`);
      }
    }

    try {
      // Try direct JSON parse first (faster than LangChain's parser)
      let rawParsed: any;
      try {
        rawParsed = JSON.parse(cleanedText);
      } catch {
        // JSON.parse failed — try repairing (single quotes, trailing commas, etc.)
        console.log("[Parser] Direct JSON.parse failed, attempting repair...");
        const repaired = repairJson(cleanedText);
        rawParsed = JSON.parse(repaired);
        console.log("[Parser] JSON repair succeeded");
      }
      const warnings: ParserWarning[] = [];

      // Apply corrections with warning tracking
      applyCorrections(rawParsed, warnings);

      if (warnings.length > 0) {
        console.log(`[Parser] ${warnings.length} warning(s): ${warnings.map(w => w.type).join(", ")}`);
      }

      // Add chain-of-thought if extracted
      if (reasoning) {
        rawParsed._chainOfThought = reasoning;
        console.log(`[Parser] Chain-of-thought captured (${reasoning.length} chars)`);
      }

      // Validate with Zod schema
      const validated = TradeDecisionSchema.parse(rawParsed);

      // Attach warnings to decision for downstream logging
      if (warnings.length > 0) {
        (validated as any)._parserWarnings = warnings;
      }

      return validated;
    } catch (jsonError) {
      console.log("[Parser] Direct JSON parse failed, trying LangChain parser...");
      // Fall back to LangChain's parser
      const result = await super.parse(cleanedText);

      if (reasoning && result.reasoning) {
        result._chainOfThought = reasoning;
      }

      return result;
    }
  }
}

// Create parser instance using reasoning-aware custom class
export const tradeDecisionParser = new ReasoningAwareParser(TradeDecisionSchema);

// Get format instructions to add to prompt
export function getFormatInstructions(): string {
  return tradeDecisionParser.getFormatInstructions();
}

// Parse the AI response (handles reasoning tags, markdown, and JSON)
// Backward-compatible: returns only the decision
export async function parseTradeDecision(text: string) {
  const { decision } = await parseTradeDecisionWithWarnings(text);
  return decision;
}

// Parse the AI response and return both decision and warnings
export async function parseTradeDecisionWithWarnings(text: string): Promise<{
  decision: any;
  warnings: ParserWarning[];
}> {
  const warnings: ParserWarning[] = [];

  try {
    // First extract any reasoning from <think> tags
    const { reasoning, content } = extractReasoningTags(text);

    // Strip markdown formatting
    let cleanedText = stripMarkdownFormatting(content);

    // Try to extract JSON if the content isn't pure JSON
    if (!cleanedText.startsWith("{")) {
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

    // Parse JSON (with repair fallback for single quotes, trailing commas)
    let rawParsed: any;
    try {
      rawParsed = JSON.parse(cleanedText);
    } catch {
      const repaired = repairJson(cleanedText);
      rawParsed = JSON.parse(repaired);
      console.log("[Parser] JSON repair succeeded (standalone parser)");
    }

    // Apply corrections with warning tracking
    applyCorrections(rawParsed, warnings);

    // Add chain-of-thought if extracted
    if (reasoning) {
      rawParsed._chainOfThought = reasoning;
      console.log(`[Parser] Chain-of-thought: ${reasoning.slice(0, 200)}...`);
    }

    // Validate with schema
    const decision = TradeDecisionSchema.parse(rawParsed);
    return { decision, warnings };
  } catch (error) {
    console.error("Failed to parse trade decision:", error);

    // Fallback: try to extract JSON from the original text (after stripping think tags)
    const { content } = extractReasoningTags(text);
    const extracted = extractFirstJsonObject(content);
    if (extracted) {
      warnings.push(
        createWarning(
          "JSON_EXTRACTION_FALLBACK",
          "JSON extracted via fallback bracket-depth parser after initial parse failure"
        )
      );

      let parsed: any;
      try {
        parsed = JSON.parse(extracted);
      } catch {
        parsed = JSON.parse(repairJson(extracted));
      }

      // Apply corrections with warning tracking
      applyCorrections(parsed, warnings);

      const decision = TradeDecisionSchema.parse(parsed);
      return { decision, warnings };
    }

    throw error;
  }
}
