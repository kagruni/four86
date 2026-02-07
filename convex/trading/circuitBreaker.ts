/**
 * Circuit Breaker for Trading Bot
 *
 * Pure functions that manage circuit breaker state to protect against:
 * - Consecutive AI failures (API errors, parse failures)
 * - Consecutive trading losses (losing streak protection)
 *
 * States:
 *   "active"   - Normal operation, trading allowed
 *   "tripped"  - Breaker tripped, trading blocked until cooldown elapses
 *   "cooldown" - First trade after cooldown, resets to "active" on success
 */

export interface CircuitBreakerState {
  circuitBreakerState?: string; // "active" | "tripped" | "cooldown"
  consecutiveAiFailures?: number;
  consecutiveLosses?: number;
  circuitBreakerTrippedAt?: number;
}

export interface CircuitBreakerConfig {
  circuitBreakerCooldownMinutes?: number; // default 30
  maxConsecutiveAiFailures?: number; // default 3
  maxConsecutiveLosses?: number; // default 5
}

const DEFAULT_COOLDOWN_MINUTES = 30;
const DEFAULT_MAX_AI_FAILURES = 3;
const DEFAULT_MAX_CONSECUTIVE_LOSSES = 5;

/**
 * Check if trading is currently allowed based on circuit breaker state.
 */
export function shouldAllowTrading(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  now: number
): { allowed: boolean; reason: string } {
  const currentState = state.circuitBreakerState ?? "active";

  if (currentState === "active" || currentState === "cooldown") {
    return { allowed: true, reason: "Circuit breaker is active" };
  }

  if (currentState === "tripped") {
    const trippedAt = state.circuitBreakerTrippedAt ?? 0;
    const cooldownMs =
      (config.circuitBreakerCooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES) *
      60 *
      1000;
    const elapsed = now - trippedAt;

    if (elapsed >= cooldownMs) {
      return {
        allowed: true,
        reason: "Cooldown period elapsed, entering cooldown state",
      };
    }

    const remainingMs = cooldownMs - elapsed;
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return {
      allowed: false,
      reason: `Circuit breaker tripped. ${remainingMinutes} minute(s) remaining in cooldown`,
    };
  }

  // Unknown state, allow trading but log
  return { allowed: true, reason: `Unknown circuit breaker state: ${currentState}` };
}

/**
 * Record an AI failure. Trips the breaker if threshold is reached.
 */
export function recordAiFailure(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig
): CircuitBreakerState {
  const failures = (state.consecutiveAiFailures ?? 0) + 1;
  const maxFailures =
    config.maxConsecutiveAiFailures ?? DEFAULT_MAX_AI_FAILURES;

  if (failures >= maxFailures) {
    return {
      ...state,
      consecutiveAiFailures: failures,
      circuitBreakerState: "tripped",
      circuitBreakerTrippedAt: Date.now(),
    };
  }

  return {
    ...state,
    consecutiveAiFailures: failures,
  };
}

/**
 * Record an AI success. Resets the failure counter and promotes cooldown to active.
 */
export function recordAiSuccess(
  state: CircuitBreakerState
): CircuitBreakerState {
  const currentState = state.circuitBreakerState ?? "active";

  return {
    ...state,
    consecutiveAiFailures: 0,
    circuitBreakerState: currentState === "cooldown" ? "active" : currentState,
  };
}

/**
 * Record a trade outcome (win or loss). Trips breaker on consecutive losses.
 */
export function recordTradeOutcome(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  won: boolean
): CircuitBreakerState {
  if (won) {
    return {
      ...state,
      consecutiveLosses: 0,
    };
  }

  const losses = (state.consecutiveLosses ?? 0) + 1;
  const maxLosses =
    config.maxConsecutiveLosses ?? DEFAULT_MAX_CONSECUTIVE_LOSSES;

  if (losses >= maxLosses) {
    return {
      ...state,
      consecutiveLosses: losses,
      circuitBreakerState: "tripped",
      circuitBreakerTrippedAt: Date.now(),
    };
  }

  return {
    ...state,
    consecutiveLosses: losses,
  };
}
