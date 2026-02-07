/**
 * Structured Logger
 *
 * Provides structured logging with component tracking and timing utilities.
 */

export type LogComponent =
  | "TRADING_LOOP"
  | "TREND_GUARD"
  | "VALIDATOR"
  | "EXECUTOR"
  | "PARSER"
  | "RESEARCH"
  | "CIRCUIT_BREAKER";

interface Logger {
  info: (message: string, data?: Record<string, any>) => void;
  warn: (message: string, data?: Record<string, any>) => void;
  error: (message: string, data?: Record<string, any>) => void;
}

export function createLogger(component: LogComponent, loopId?: number, userId?: string): Logger {
  const prefix = [
    loopId ? `[LOOP-${loopId}]` : null,
    `[${component}]`,
    userId ? `[${userId.slice(0, 8)}]` : null,
  ].filter(Boolean).join(" ");

  return {
    info: (message: string, data?: Record<string, any>) => {
      if (data) {
        console.log(`${prefix} ${message}`, JSON.stringify(data));
      } else {
        console.log(`${prefix} ${message}`);
      }
    },
    warn: (message: string, data?: Record<string, any>) => {
      if (data) {
        console.warn(`${prefix} ${message}`, JSON.stringify(data));
      } else {
        console.warn(`${prefix} ${message}`);
      }
    },
    error: (message: string, data?: Record<string, any>) => {
      if (data) {
        console.error(`${prefix} ${message}`, JSON.stringify(data));
      } else {
        console.error(`${prefix} ${message}`);
      }
    },
  };
}

/**
 * Wrap an async function with duration tracking.
 * Returns the result and logs the duration.
 */
export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
  logger?: Logger
): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;

  if (logger) {
    logger.info(`${label} completed in ${durationMs}ms`);
  } else {
    console.log(`[TIMING] ${label}: ${durationMs}ms`);
  }

  return { result, durationMs };
}
