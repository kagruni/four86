import type { DecisionContext, SymbolMarketSnapshot } from "../decisionContext";

export interface RegimeValidationResult {
  allowed: boolean;
  reason: string;
  checks: string[];
  snapshot?: SymbolMarketSnapshot;
}

type DirectionalDecision = "OPEN_LONG" | "OPEN_SHORT";
type DirectionalBias = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface RegimeEvaluationInput {
  priceVsEma20Pct: number;
  momentum: string;
  hourlyEma20: number;
  hourlyEma50: number;
  dayChangePct: number;
  fourHourEma20?: number;
  fourHourEma50?: number;
  fourHourTrendPct?: number;
}

const HOURLY_ALIGNMENT_TOLERANCE_PCT = 0.15;
const FOUR_HOUR_BIAS_THRESHOLD_PCT = 0.3;
const RECOVERY_PRICE_BUFFER_PCT = 0.15;

function getConfigValue(rawValue: number | boolean | undefined, fallback: number | boolean) {
  return rawValue === undefined ? fallback : rawValue;
}

function calculatePctGap(fast: number | undefined, slow: number | undefined) {
  if (fast == null || slow == null || slow === 0) return 0;
  return ((fast - slow) / slow) * 100;
}

function getDirectionalBias(pct: number, threshold: number): DirectionalBias {
  if (pct >= threshold) return "BULLISH";
  if (pct <= -threshold) return "BEARISH";
  return "NEUTRAL";
}

function hasDirectionalRecovery(
  decision: DirectionalDecision,
  priceVsEma20Pct: number,
  momentum: string
) {
  if (decision === "OPEN_LONG") {
    return priceVsEma20Pct >= -RECOVERY_PRICE_BUFFER_PCT && momentum !== "FALLING";
  }

  return priceVsEma20Pct <= RECOVERY_PRICE_BUFFER_PCT && momentum !== "RISING";
}

export function evaluateDirectionalRegime(
  bot: any,
  decision: DirectionalDecision,
  input: RegimeEvaluationInput
): Pick<RegimeValidationResult, "allowed" | "reason" | "checks"> {
  const enableRegimeFilter = Boolean(getConfigValue(bot.enableRegimeFilter, true));
  if (!enableRegimeFilter) {
    return {
      allowed: true,
      reason: "Regime filter disabled in bot config",
      checks: ["disabled"],
    };
  }

  const require1hAlignment = Boolean(getConfigValue(bot.require1hAlignment, true));
  const redDayLongBlockPct = Number(getConfigValue(bot.redDayLongBlockPct, -1.5));
  const greenDayShortBlockPct = Number(getConfigValue(bot.greenDayShortBlockPct, 1.5));
  const isLong = decision === "OPEN_LONG";
  const checks: string[] = [];

  const hourlyGapPct = calculatePctGap(input.hourlyEma20, input.hourlyEma50);
  const fourHourTrendPct = input.fourHourTrendPct ?? calculatePctGap(input.fourHourEma20, input.fourHourEma50);
  const hourlyBias = getDirectionalBias(hourlyGapPct, HOURLY_ALIGNMENT_TOLERANCE_PCT);
  const fourHourBias = getDirectionalBias(fourHourTrendPct, FOUR_HOUR_BIAS_THRESHOLD_PCT);
  const intradayRecovery = hasDirectionalRecovery(decision, input.priceVsEma20Pct, input.momentum);
  const higherTimeframeSupport = isLong ? fourHourBias !== "BEARISH" : fourHourBias !== "BULLISH";
  const counterHourlyBias = isLong ? hourlyBias === "BEARISH" : hourlyBias === "BULLISH";

  if (isLong) {
    if (input.priceVsEma20Pct < -0.3 && input.momentum === "FALLING") {
      return {
        allowed: false,
        reason: `Long blocked: price is ${input.priceVsEma20Pct.toFixed(2)}% below EMA20 with falling momentum`,
        checks: ["intraday_long_block"],
      };
    }
  } else if (input.priceVsEma20Pct > 0.3 && input.momentum === "RISING") {
    return {
      allowed: false,
      reason: `Short blocked: price is ${input.priceVsEma20Pct.toFixed(2)}% above EMA20 with rising momentum`,
      checks: ["intraday_short_block"],
    };
  }

  if (require1hAlignment && counterHourlyBias) {
    if (!(intradayRecovery && higherTimeframeSupport)) {
      return {
        allowed: false,
        reason: isLong
          ? `Long blocked: 1h EMA20 is ${Math.abs(hourlyGapPct).toFixed(2)}% below EMA50 without intraday recovery and supportive 4h context`
          : `Short blocked: 1h EMA20 is ${Math.abs(hourlyGapPct).toFixed(2)}% above EMA50 without intraday rollover and supportive 4h context`,
        checks: [isLong ? "hourly_long_misaligned" : "hourly_short_misaligned"],
      };
    }

    checks.push(isLong ? "hourly_long_recovery_exception" : "hourly_short_recovery_exception");
  } else if (require1hAlignment) {
    checks.push(
      hourlyBias === "NEUTRAL"
        ? isLong
          ? "hourly_long_neutral"
          : "hourly_short_neutral"
        : isLong
          ? "hourly_long_aligned"
          : "hourly_short_aligned"
    );
  }

  if (isLong) {
    if (input.dayChangePct <= redDayLongBlockPct && !(intradayRecovery && higherTimeframeSupport)) {
      return {
        allowed: false,
        reason: `Long blocked: session is red (${input.dayChangePct.toFixed(2)}%) without bullish intraday recovery and supportive 4h context`,
        checks: [...checks, "red_day_long_block"],
      };
    }
    if (input.dayChangePct <= redDayLongBlockPct) checks.push("red_day_long_exception");
  } else {
    if (input.dayChangePct >= greenDayShortBlockPct && !(intradayRecovery && higherTimeframeSupport)) {
      return {
        allowed: false,
        reason: `Short blocked: session is green (${input.dayChangePct.toFixed(2)}%) without bearish intraday rollover and supportive 4h context`,
        checks: [...checks, "green_day_short_block"],
      };
    }
    if (input.dayChangePct >= greenDayShortBlockPct) checks.push("green_day_short_exception");
  }

  return {
    allowed: true,
    reason: "Regime checks passed",
    checks,
  };
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

  const evaluation = evaluateDirectionalRegime(bot, decision.decision, {
    priceVsEma20Pct: snapshot.intraday.priceVsEma20Pct,
    momentum: snapshot.intraday.momentum,
    hourlyEma20: snapshot.hourly.ema20,
    hourlyEma50: snapshot.hourly.ema50,
    dayChangePct: snapshot.dayChangePct,
    fourHourEma20: snapshot.fourHour.ema20,
    fourHourEma50: snapshot.fourHour.ema50,
    fourHourTrendPct: snapshot.fourHour.ema20VsEma50Pct,
  });

  return {
    allowed: evaluation.allowed,
    reason: evaluation.reason,
    checks: evaluation.checks,
    snapshot,
  };
}
