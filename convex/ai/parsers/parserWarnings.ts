/**
 * Parser Warnings
 *
 * Structured warning types for tracking parser corrections and fallbacks.
 */

export type ParserWarningType =
  | "LEVERAGE_CORRECTED"
  | "SYMBOL_CORRECTED"
  | "JSON_EXTRACTION_FALLBACK"
  | "LEGACY_FORMAT_RECOVERED"
  | "MULTIPLE_DECISIONS_DROPPED";

export interface ParserWarning {
  type: ParserWarningType;
  message: string;
  original?: any;
  corrected?: any;
}

export function createWarning(
  type: ParserWarningType,
  message: string,
  original?: any,
  corrected?: any
): ParserWarning {
  return { type, message, original, corrected };
}
