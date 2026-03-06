import type { DecisionContext, SymbolMarketSnapshot } from "../decisionContext";

export interface RegimeValidationResult {
  allowed: boolean;
  reason: string;
  checks: string[];
  snapshot?: SymbolMarketSnapshot;
}

function getConfigValue(rawValue: number | boolean | undefined, fallback: number | boolean) {
  return rawValue === undefined ? fallback : rawValue;
}

export function validateDecisionAgainstRegime(
  bot: any,
  decision: any,
  decisionContext: DecisionContext
): RegimeValidationResult {
  if (decision.decision !== "OPEN_LONG" && decision.decision !== "OPEN_SHORT") {
    return {
      allowed: true,
      reason: "Regime filter skipped for non-open decision",
      checks: [],
    };
  }

  const snapshot = decision.symbol
    ? decisionContext.marketSnapshot.symbols[decision.symbol]
    : undefined;

  if (!snapshot) {
    return {
      allowed: true,
      reason: "No shared market snapshot for symbol",
      checks: ["missing_snapshot"],
    };
  }

  const enableRegimeFilter = Boolean(getConfigValue(bot.enableRegimeFilter, true));
  if (!enableRegimeFilter) {
    return {
      allowed: true,
      reason: "Regime filter disabled in bot config",
      checks: ["disabled"],
      snapshot,
    };
  }

  const require1hAlignment = Boolean(getConfigValue(bot.require1hAlignment, true));
  const redDayLongBlockPct = Number(getConfigValue(bot.redDayLongBlockPct, -1.5));
  const greenDayShortBlockPct = Number(getConfigValue(bot.greenDayShortBlockPct, 1.5));

  const checks: string[] = [];
  const { intraday, hourly, dayChangePct } = snapshot;

  if (decision.decision === "OPEN_LONG") {
    if (intraday.priceVsEma20Pct < -0.3 && intraday.momentum === "FALLING") {
      return {
        allowed: false,
        reason: `Long blocked: price is ${intraday.priceVsEma20Pct.toFixed(2)}% below EMA20 with falling momentum`,
        checks: [...checks, "intraday_long_block"],
        snapshot,
      };
    }

    if (require1hAlignment && hourly.ema20 < hourly.ema50) {
      return {
        allowed: false,
        reason: "Long blocked: 1h EMA20 is below EMA50",
        checks: [...checks, "hourly_long_misaligned"],
        snapshot,
      };
    }
    if (require1hAlignment) checks.push("hourly_long_aligned");

    const hasRecoveryException =
      hourly.ema20 >= hourly.ema50 && intraday.momentum !== "FALLING";
    if (dayChangePct <= redDayLongBlockPct && !hasRecoveryException) {
      return {
        allowed: false,
        reason: `Long blocked: session is red (${dayChangePct.toFixed(2)}%) without bullish 1h/intraday recovery`,
        checks: [...checks, "red_day_long_block"],
        snapshot,
      };
    }
    if (dayChangePct <= redDayLongBlockPct) checks.push("red_day_long_exception");
  }

  if (decision.decision === "OPEN_SHORT") {
    if (intraday.priceVsEma20Pct > 0.3 && intraday.momentum === "RISING") {
      return {
        allowed: false,
        reason: `Short blocked: price is ${intraday.priceVsEma20Pct.toFixed(2)}% above EMA20 with rising momentum`,
        checks: [...checks, "intraday_short_block"],
        snapshot,
      };
    }

    if (require1hAlignment && hourly.ema20 > hourly.ema50) {
      return {
        allowed: false,
        reason: "Short blocked: 1h EMA20 is above EMA50",
        checks: [...checks, "hourly_short_misaligned"],
        snapshot,
      };
    }
    if (require1hAlignment) checks.push("hourly_short_aligned");

    const hasRecoveryException =
      hourly.ema20 <= hourly.ema50 && intraday.momentum !== "RISING";
    if (dayChangePct >= greenDayShortBlockPct && !hasRecoveryException) {
      return {
        allowed: false,
        reason: `Short blocked: session is green (${dayChangePct.toFixed(2)}%) without bearish 1h/intraday rollover`,
        checks: [...checks, "green_day_short_block"],
        snapshot,
      };
    }
    if (dayChangePct >= greenDayShortBlockPct) checks.push("green_day_short_exception");
  }

  return {
    allowed: true,
    reason: "Regime checks passed",
    checks,
    snapshot,
  };
}
