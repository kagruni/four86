import { StructuredOutputParser } from "langchain/output_parsers";
import { TradeDecisionSchema } from "./schemas";

export const tradeDecisionParser = StructuredOutputParser.fromZodSchema(
  TradeDecisionSchema
);

// Get format instructions to add to prompt
export function getFormatInstructions(): string {
  return tradeDecisionParser.getFormatInstructions();
}

// Parse the AI response
export async function parseTradeDecision(text: string) {
  try {
    return await tradeDecisionParser.parse(text);
  } catch (error) {
    console.error("Failed to parse trade decision:", error);

    // Fallback: try to extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return TradeDecisionSchema.parse(parsed);
    }

    throw error;
  }
}
