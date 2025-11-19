import { StructuredOutputParser } from "langchain/output_parsers";
import { TradeDecisionSchema } from "./schemas";

// Custom parser that strips markdown code blocks before parsing
class MarkdownStrippingParser extends StructuredOutputParser {
  async parse(text: string): Promise<any> {
    // Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
    let cleanedText = text.trim();
    if (cleanedText.startsWith("```")) {
      // Remove opening code fence (```json or ```)
      cleanedText = cleanedText.replace(/^```(?:json)?\s*\n?/, "");
      // Remove closing code fence
      cleanedText = cleanedText.replace(/\n?```\s*$/, "");
      cleanedText = cleanedText.trim();
    }

    // Call parent parse method with cleaned text
    return super.parse(cleanedText);
  }
}

// Create parser instance using custom class
const baseParser = StructuredOutputParser.fromZodSchema(TradeDecisionSchema);
export const tradeDecisionParser = new MarkdownStrippingParser(
  (baseParser as any).schema,
  (baseParser as any).zodSchema
);

// Get format instructions to add to prompt
export function getFormatInstructions(): string {
  return tradeDecisionParser.getFormatInstructions();
}

// Parse the AI response
export async function parseTradeDecision(text: string) {
  try {
    // Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
    let cleanedText = text.trim();
    if (cleanedText.startsWith("```")) {
      // Remove opening code fence (```json or ```)
      cleanedText = cleanedText.replace(/^```(?:json)?\s*\n?/, "");
      // Remove closing code fence
      cleanedText = cleanedText.replace(/\n?```\s*$/, "");
      cleanedText = cleanedText.trim();
    }

    return await tradeDecisionParser.parse(cleanedText);
  } catch (error) {
    console.error("Failed to parse trade decision:", error);

    // Fallback: try to extract JSON from the original text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return TradeDecisionSchema.parse(parsed);
    }

    throw error;
  }
}
