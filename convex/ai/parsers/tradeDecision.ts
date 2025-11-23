import { StructuredOutputParser } from "langchain/output_parsers";
import { TradeDecisionSchema } from "./schemas";

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

// Custom parser that handles reasoning tags, markdown, and malformed responses
class ReasoningAwareParser extends StructuredOutputParser {
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
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
        console.log(`[Parser] Extracted JSON: ${cleanedText.slice(0, 100)}...`);
      } else {
        console.error("[Parser] No JSON found in response");
        throw new Error(`No JSON found in response. First 200 chars: ${cleanedText.slice(0, 200)}`);
      }
    }

    try {
      // Try direct JSON parse first (faster than LangChain's parser)
      const rawParsed = JSON.parse(cleanedText);

      // Fix leverage if < 1 (perpetual futures requirement)
      if (rawParsed.leverage !== null && rawParsed.leverage !== undefined && rawParsed.leverage < 1) {
        console.log(`[Parser] Correcting leverage from ${rawParsed.leverage} to 1`);
        rawParsed.leverage = 1;
      }

      // Add chain-of-thought if extracted
      if (reasoning) {
        rawParsed._chainOfThought = reasoning;
        console.log(`[Parser] Chain-of-thought captured (${reasoning.length} chars)`);
      }

      // Validate with Zod schema
      return TradeDecisionSchema.parse(rawParsed);
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
const baseParser = StructuredOutputParser.fromZodSchema(TradeDecisionSchema);
export const tradeDecisionParser = new ReasoningAwareParser(
  (baseParser as any).schema,
  (baseParser as any).zodSchema
);

// Get format instructions to add to prompt
export function getFormatInstructions(): string {
  return tradeDecisionParser.getFormatInstructions();
}

// Parse the AI response (handles reasoning tags, markdown, and JSON)
export async function parseTradeDecision(text: string) {
  try {
    // First extract any reasoning from <think> tags
    const { reasoning, content } = extractReasoningTags(text);

    // Strip markdown formatting
    let cleanedText = stripMarkdownFormatting(content);

    // Try to extract JSON if the content isn't pure JSON
    if (!cleanedText.startsWith("{")) {
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }
    }

    // Parse JSON
    const rawParsed = JSON.parse(cleanedText);

    // Fix leverage if < 1 (perpetual futures requirement)
    if (rawParsed.leverage !== null && rawParsed.leverage !== undefined && rawParsed.leverage < 1) {
      console.log(`[Parser] Correcting leverage from ${rawParsed.leverage} to 1 (minimum for perpetual futures)`);
      rawParsed.leverage = 1;
    }

    // Add chain-of-thought if extracted
    if (reasoning) {
      rawParsed._chainOfThought = reasoning;
      console.log(`[Parser] Chain-of-thought: ${reasoning.slice(0, 200)}...`);
    }

    // Validate with schema
    return TradeDecisionSchema.parse(rawParsed);
  } catch (error) {
    console.error("Failed to parse trade decision:", error);

    // Fallback: try to extract JSON from the original text (after stripping think tags)
    const { content } = extractReasoningTags(text);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Fix leverage if < 1
      if (parsed.leverage !== null && parsed.leverage !== undefined && parsed.leverage < 1) {
        console.log(`[Parser Fallback] Correcting leverage from ${parsed.leverage} to 1 (minimum for perpetual futures)`);
        parsed.leverage = 1;
      }

      return TradeDecisionSchema.parse(parsed);
    }

    throw error;
  }
}
