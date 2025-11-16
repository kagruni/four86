import { z } from "zod";

// Trading decision schema
export const TradeDecisionSchema = z.object({
  reasoning: z.string().describe("Detailed analysis of market conditions and trade rationale"),

  decision: z.enum(["OPEN_LONG", "OPEN_SHORT", "CLOSE", "HOLD"])
    .describe("The action to take"),

  symbol: z.enum(["BTC", "ETH", "SOL", "BNB", "DOGE"])
    .optional()
    .describe("Symbol to trade (required for OPEN actions)"),

  confidence: z.number().min(0).max(1)
    .describe("Confidence level in this decision (0-1)"),

  leverage: z.number().min(1).max(20)
    .optional()
    .describe("Leverage to use (required for OPEN actions)"),

  size_usd: z.number().positive()
    .optional()
    .describe("Position size in USD (required for OPEN actions)"),

  stop_loss: z.number().positive()
    .optional()
    .describe("Stop loss price (required for OPEN actions)"),

  take_profit: z.number().positive()
    .optional()
    .describe("Take profit price (required for OPEN actions)"),

  risk_reward_ratio: z.number()
    .optional()
    .describe("Calculated risk/reward ratio"),
});

export type TradeDecision = z.infer<typeof TradeDecisionSchema>;

// Market analysis schema
export const MarketAnalysisSchema = z.object({
  symbol: z.string(),
  trend: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
  strength: z.number().min(0).max(10),
  key_levels: z.object({
    support: z.array(z.number()),
    resistance: z.array(z.number()),
  }),
  indicators: z.object({
    rsi_signal: z.enum(["OVERSOLD", "OVERBOUGHT", "NEUTRAL"]),
    macd_signal: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
    volume_signal: z.enum(["HIGH", "NORMAL", "LOW"]),
  }),
  summary: z.string(),
});

export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;
