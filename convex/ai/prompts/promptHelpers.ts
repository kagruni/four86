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
  managedExitEnabled?: boolean;
  includeSuggestedZones?: boolean;
  includeLossContext?: boolean;
}

/**
 * Generate all template variables for the system prompt based on bot config
 */
export function generatePromptVariables(config: BotConfig) {
  // Calculate reduced risk percentage for after consecutive losses
  const perTradeRiskPctReduced = Math.max(config.perTradeRiskPct * 0.75, 1.5);

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
    ? "Prefer 2m and 4h trends aligned; treat counter-trend ideas with extra caution"
    : "Counter-trend trades are allowed if 2m signals are strong enough";

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
  const managedExitGuidance = config.managedExitEnabled
    ? "Managed exits are ENABLED for new positions: provide stop_loss, but do not require a fixed take_profit. Positions marked MANAGED_EXIT are controlled by system rules and must be held."
    : "Managed exits are DISABLED: every new position must include both stop_loss and take_profit, and existing positions rely on exchange TP/SL.";
  const suggestedZonesGuidance = config.includeSuggestedZones
    ? "Each coin's [SUGGESTED ZONES] shows pre-calculated $ levels you can use as reference"
    : "If you open a trade, derive stop_loss and take_profit from the market structure and ATR guidance rather than relying on precomputed zone scaffolding";
  const suggestedZonesAnalysisStep = config.includeSuggestedZones
    ? "Check [SUGGESTED ZONES] for pre-calculated ATR-based TP/SL levels"
    : "If you are considering an entry, derive TP/SL from ATR guidance and the live structure yourself";
  const lossContextSection = config.includeLossContext
    ? `LOSS CONTEXT:
- Consecutive losses: {consecutiveLosses} / {consecutiveLossLimit}
- {lossStreakStatus}
- After hitting loss limit: reduce risk to {perTradeRiskPct}% × 0.75 until 1 win`
    : "";
  const lossContextSummary = config.includeLossContext
    ? `Consecutive Losses: {consecutiveLosses} / {consecutiveLossLimit}
Loss Streak Status: {lossStreakStatus}`
    : "";

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
    managedExitGuidance,
    suggestedZonesGuidance,
    suggestedZonesAnalysisStep,
    lossContextSection,
    lossContextSummary,
  };
}
