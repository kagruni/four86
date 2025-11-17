/**
 * Helper functions to populate prompt template variables from bot config
 */

export interface BotConfig {
  maxLeverage: number;
  maxPositionSize: number;
  maxDailyLoss: number;
  minAccountValue: number;
  perTradeRiskPct: number;
  maxTotalPositions: number;
  maxSameDirectionPositions: number;
  consecutiveLossLimit: number;
  tradingMode: string;
  minEntryConfidence: number;
  minRiskRewardRatio: number;
  stopOutCooldownHours: number;
  minEntrySignals: number;
  require4hAlignment: boolean;
  tradeVolatileMarkets: boolean;
  volatilitySizeReduction: number;
  stopLossAtrMultiplier: number;
}

/**
 * Generate all template variables for the system prompt based on bot config
 */
export function generatePromptVariables(config: BotConfig) {
  // Calculate reduced risk percentage for after consecutive losses
  const perTradeRiskPctReduced = Math.max(config.perTradeRiskPct * 0.5, 1.0);

  // Determine trading mode description
  let tradingModeDescription = "";
  if (config.tradingMode === "conservative") {
    tradingModeDescription = "Conservative (Higher confidence, fewer trades, quality over quantity)";
  } else if (config.tradingMode === "aggressive") {
    tradingModeDescription = "Aggressive (More trades, lower confidence threshold, active trading)";
  } else {
    tradingModeDescription = "Balanced (Standard settings, quality trades with reasonable frequency)";
  }

  // Conditional rules based on settings
  const volatileTradeRule = config.tradeVolatileMarkets
    ? "but continue trading with reduced size"
    : "STOP trading until volatility normalizes";

  const volatileFilterRule = config.tradeVolatileMarkets
    ? `Volatile markets (ATR3 > 1.5x ATR14) - reduce size by ${config.volatilitySizeReduction}%`
    : "Volatile markets (ATR3 > 1.5x ATR14) - DO NOT trade";

  const volatileCheckRule = config.tradeVolatileMarkets
    ? `Volatile markets: Size reduced by ${config.volatilitySizeReduction}%`
    : "Not in volatile market (ATR3 ≤ 1.5x ATR14)";

  const volatilityPrinciple = config.tradeVolatileMarkets
    ? `Volatile markets: Reduce size by ${config.volatilitySizeReduction}%, expect wider swings`
    : "Volatile markets: Avoid trading, wait for stabilization";

  const trend4hRule = config.require4hAlignment
    ? "MUST have 2m and 4h trends aligned (counter-trend trades forbidden)"
    : "Counter-trend trades allowed if 2m signals strong (3+ signals, higher confidence)";

  const trend4hFilterRule = config.require4hAlignment
    ? "2m and 4h trends not aligned (required for this trading mode)"
    : "";

  const trend4hCheckRule = config.require4hAlignment
    ? "2m and 4h trends aligned"
    : "Trend alignment: recommended but not required";

  const trend4hPrinciple = config.require4hAlignment
    ? "Always trade with 4h trend - no counter-trend trades"
    : "Counter-trend trades allowed with strong 2m signals";

  const confidence4hPenalty = config.require4hAlignment
    ? "-0.15: Counter to 4h trend (avoid these trades)"
    : "-0.10: Counter to 4h trend (requires stronger 2m signals)";

  const confidenceSizingRule = ""; // Placeholder for future confidence-based sizing

  return {
    // Core config
    maxLeverage: config.maxLeverage,
    maxPositionSize: config.maxPositionSize,
    maxDailyLoss: config.maxDailyLoss,
    minAccountValue: config.minAccountValue,
    perTradeRiskPct: config.perTradeRiskPct,
    perTradeRiskPctReduced,
    maxTotalPositions: config.maxTotalPositions,
    maxSameDirectionPositions: config.maxSameDirectionPositions,
    consecutiveLossLimit: config.consecutiveLossLimit,

    // Trading strategy
    tradingMode: config.tradingMode,
    tradingModeDescription,
    minEntryConfidence: config.minEntryConfidence,
    minRiskRewardRatio: config.minRiskRewardRatio,
    stopOutCooldownHours: config.stopOutCooldownHours,
    minEntrySignals: config.minEntrySignals,
    require4hAlignment: config.require4hAlignment,
    tradeVolatileMarkets: config.tradeVolatileMarkets,
    volatilitySizeReduction: config.volatilitySizeReduction,
    stopLossAtrMultiplier: config.stopLossAtrMultiplier,

    // Conditional rules
    volatileTradeRule,
    volatileFilterRule,
    volatileCheckRule,
    volatilityPrinciple,
    trend4hRule,
    trend4hFilterRule,
    trend4hCheckRule,
    trend4hPrinciple,
    confidence4hPenalty,
    confidenceSizingRule,
  };
}
