/**
 * Signal Processing Types
 *
 * These types define the pre-processed signals that replace raw data arrays
 * in the AI trading prompt. Instead of sending [87678, 87700, 87733...],
 * we send structured insights like "BULLISH (7/10), 3 entry signals".
 */

// =============================================================================
// TREND ANALYSIS
// =============================================================================

export type TrendDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type MomentumState = "ACCELERATING" | "STEADY" | "DECELERATING";

export interface TrendAnalysis {
  /** Overall trend direction */
  direction: TrendDirection;
  /** Trend strength on 1-10 scale */
  strength: number;
  /** Is momentum increasing or decreasing? */
  momentum: MomentumState;
  /** Are 2-minute and 4-hour trends aligned? */
  timeframeAlignment: boolean;
  /** Price position relative to EMA20 (percentage) */
  priceVsEma20Pct: number;
  /** EMA20 vs EMA50 on 4h (percentage) */
  ema20VsEma50Pct: number;
}

// =============================================================================
// MARKET REGIME
// =============================================================================

export type RegimeType = "TRENDING" | "RANGING" | "VOLATILE";
export type VolatilityLevel = "LOW" | "NORMAL" | "HIGH" | "EXTREME";

export interface MarketRegime {
  /** Current market regime classification */
  type: RegimeType;
  /** Volatility assessment */
  volatility: VolatilityLevel;
  /** ATR3/ATR14 ratio (>1.5 = increasing volatility) */
  atrRatio: number;
  /** Volume relative to average (1.0 = average) */
  volumeRatio: number;
}

// =============================================================================
// KEY PRICE LEVELS
// =============================================================================

export interface KeyLevels {
  /** Resistance levels above current price (up to 3) */
  resistance: number[];
  /** Support levels below current price (up to 3) */
  support: number[];
  /** 24-hour high */
  high24h: number;
  /** 24-hour low */
  low24h: number;
  /** Pivot point: (H + L + C) / 3 */
  pivotPoint: number;
  /** Distance to nearest resistance (percentage) */
  distanceToResistancePct: number;
  /** Distance to nearest support (percentage) */
  distanceToSupportPct: number;
}

// =============================================================================
// ENTRY SIGNALS
// =============================================================================

export type EntrySignalType =
  | "RSI_OVERSOLD"        // RSI < 30 and rising
  | "RSI_OVERBOUGHT"      // RSI > 70 and falling
  | "RSI_MOMENTUM_BULL"   // RSI crosses above 50
  | "RSI_MOMENTUM_BEAR"   // RSI crosses below 50
  | "MACD_CROSS_BULL"     // MACD crosses above signal
  | "MACD_CROSS_BEAR"     // MACD crosses below signal
  | "EMA_BREAKOUT_BULL"   // Price crosses above EMA20 with volume
  | "EMA_BREAKOUT_BEAR"   // Price crosses below EMA20 with volume
  | "HIGHER_LOW"          // Bullish price action
  | "LOWER_HIGH"          // Bearish price action
  | "VOLUME_SPIKE"        // Volume > 1.5x average
  | "BULLISH_DIVERGENCE"  // Price LL, indicator HL
  | "BEARISH_DIVERGENCE"; // Price HH, indicator LH

export type SignalStrength = "WEAK" | "MODERATE" | "STRONG";
export type SignalDirection = "LONG" | "SHORT";

export interface EntrySignal {
  /** Type of signal detected */
  type: EntrySignalType;
  /** Signal strength classification */
  strength: SignalStrength;
  /** Direction this signal suggests */
  direction: SignalDirection;
  /** Human-readable description */
  description: string;
}

// =============================================================================
// DIVERGENCE
// =============================================================================

export type DivergenceType = "BULLISH" | "BEARISH";
export type DivergenceIndicator = "RSI" | "MACD";

export interface Divergence {
  /** Type of divergence */
  type: DivergenceType;
  /** Which indicator shows divergence */
  indicator: DivergenceIndicator;
  /** Strength of the divergence */
  strength: SignalStrength;
  /** Description of the divergence */
  description: string;
}

// =============================================================================
// RISK ASSESSMENT
// =============================================================================

export interface RiskAssessment {
  /** Overall risk score 1-10 (10 = highest risk) */
  score: number;
  /** List of identified risk factors */
  factors: string[];
  /** Is this a counter-trend setup? */
  counterTrend: boolean;
  /** Recommended position size multiplier (0.5 = half size, 1.0 = full) */
  sizeMultiplier: number;
}

// =============================================================================
// COMPLETE COIN SIGNAL SUMMARY
// =============================================================================

export interface CoinSignalSummary {
  /** Trading symbol (BTC, ETH, etc.) */
  symbol: string;
  /** Current price */
  currentPrice: number;

  // Pre-calculated insights
  /** Trend analysis */
  trend: TrendAnalysis;
  /** Market regime classification */
  regime: MarketRegime;
  /** Key support/resistance levels */
  keyLevels: KeyLevels;
  /** Detected entry signals */
  entrySignals: EntrySignal[];
  /** Detected divergences */
  divergences: Divergence[];
  /** Risk assessment */
  risk: RiskAssessment;

  // Minimal raw data (for reference)
  /** Current RSI (14-period) */
  rsi14: number;
  /** Current MACD value */
  macd: number;
  /** Current MACD signal line */
  macdSignal: number;
  /** Funding rate */
  fundingRate: number | null;

  // Actionable summary
  /** One-line human-readable summary for the prompt */
  summary: string;
  /** Recommended action based on signals */
  recommendation: "STRONG_LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG_SHORT";
}

// =============================================================================
// POSITION-SPECIFIC SIGNALS
// =============================================================================

export interface PositionSignals {
  /** Symbol of the position */
  symbol: string;
  /** Current P&L percentage */
  pnlPct: number;
  /** Is invalidation condition triggered? */
  invalidationTriggered: boolean;
  /** Reason for invalidation (if triggered) */
  invalidationReason: string | null;
  /** Is price approaching stop loss? */
  nearStopLoss: boolean;
  /** Is price approaching take profit? */
  nearTakeProfit: boolean;
  /** Should this position be closed? */
  shouldClose: boolean;
  /** Reason for closing recommendation */
  closeReason: string | null;
}

// =============================================================================
// MARKET OVERVIEW
// =============================================================================

export interface MarketOverview {
  /** Overall market sentiment across all coins */
  sentiment: "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL";
  /** Number of coins with bullish signals */
  bullishCount: number;
  /** Number of coins with bearish signals */
  bearishCount: number;
  /** Best opportunity coin */
  bestOpportunity: string | null;
  /** Best opportunity direction */
  bestDirection: SignalDirection | null;
  /** Highest signal count */
  maxSignalCount: number;
}

// =============================================================================
// PROCESSED SIGNALS OUTPUT
// =============================================================================

export interface ProcessedSignals {
  /** Timestamp of signal processing */
  timestamp: string;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Signals for each coin */
  coins: Record<string, CoinSignalSummary>;
  /** Signals for existing positions */
  positions: PositionSignals[];
  /** Market overview */
  overview: MarketOverview;
}
