/**
 * OpenAI-compatible tool/function definitions for trading decisions
 * Used with ZhipuAI and other models that support function calling
 */

export const makeTradingDecisionTool = {
  type: "function",
  function: {
    name: "make_trading_decision",
    description: "Make a trading decision based on market analysis. Call this function once you've analyzed the market data and determined your trading action.",
    parameters: {
      type: "object",
      properties: {
        reasoning: {
          type: "string",
          description: "Detailed reasoning for the trading decision, including technical analysis, market conditions, and risk assessment. Be specific about indicators and signals."
        },
        decision: {
          type: "string",
          enum: ["HOLD", "OPEN_LONG", "OPEN_SHORT", "CLOSE"],
          description: "The trading action to take: HOLD (do nothing or maintain position), OPEN_LONG (buy/long), OPEN_SHORT (sell/short), or CLOSE (close existing position)"
        },
        symbol: {
          type: "string",
          description: "The trading symbol (e.g., BTC, ETH, SOL). Only required for OPEN_LONG, OPEN_SHORT, or CLOSE decisions."
        },
        confidence: {
          type: "number",
          description: "Confidence level for this decision (0.0 to 1.0). Minimum 0.60 for opening new positions. Higher confidence allows higher leverage.",
          minimum: 0,
          maximum: 1
        },
        leverage: {
          type: "number",
          description: "Leverage multiplier for the position (e.g., 3 for 3x). Only required for OPEN_LONG or OPEN_SHORT. Choose based on confidence: 0.80+ = max leverage, 0.65-0.80 = 50-70%, 0.60-0.65 = 30-50%.",
          minimum: 1
        },
        size_usd: {
          type: "number",
          description: "Position size in USD. Only required for OPEN_LONG or OPEN_SHORT. Calculate using risk formula: (Account Value × Risk % / Stop Distance) × Entry Price. Typically 2-3% risk per trade.",
          minimum: 0
        },
        stop_loss: {
          type: "number",
          description: "Stop loss price level. Only required for OPEN_LONG or OPEN_SHORT. Must provide clear invalidation price.",
          minimum: 0
        },
        take_profit: {
          type: "number",
          description: "Take profit price level. Only required for OPEN_LONG or OPEN_SHORT. Aim for minimum 1.5:1 risk/reward ratio.",
          minimum: 0
        },
        risk_reward_ratio: {
          type: "number",
          description: "Risk/reward ratio for the trade (e.g., 2.0 for 2:1). Only for OPEN_LONG or OPEN_SHORT. Minimum 1.5:1 required.",
          minimum: 0
        }
      },
      required: ["reasoning", "decision", "confidence"]
    }
  }
};

/**
 * Get all trading tools
 */
export function getTradingTools() {
  return [makeTradingDecisionTool];
}
