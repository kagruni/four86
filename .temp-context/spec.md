# AI Decision System Refactor - Technical Specification

## Problem Statement

The Four86 trading bot's AI decision system currently suffers from several architectural issues that reduce reliability and performance:

### Current Issues

1. **Oversized Prompt (680 lines)**
   - The system prompt in `detailedSystem.ts` is 486 lines
   - Market data formatting adds ~150+ lines per invocation
   - Combined token count exceeds optimal context window utilization
   - Results in model truncation and malformed JSON responses

2. **Raw Data Instead of Insights**
   - Sending arrays like `[87678.00, 87700.00, 87733.00...]`
   - Model must manually calculate trends, divergences, and signals
   - No pre-computed support/resistance levels
   - Missing market regime classification

3. **Model Overwhelm**
   - 6 coins x ~60 lines of data each = 360+ lines of market data alone
   - Model attempts to re-derive signals that could be pre-calculated
   - Inconsistent outputs due to cognitive overload
   - JSON parsing failures in `tradeDecision.ts`

4. **Missing Critical Data**
   - No order book depth (bid/ask imbalance)
   - No liquidation level clustering
   - No divergence detection (RSI/price)
   - No support/resistance calculation
   - No multi-timeframe trend alignment scoring

---

## Goals

1. **Pre-process signals** - Calculate actionable insights before AI invocation
2. **Shorter prompt** - Reduce from 680 lines to ~100-150 lines
3. **Richer data** - Add support/resistance, divergences, trend strength, market regime
4. **Faster responses** - Less parsing = faster + more reliable outputs
5. **Maintain compatibility** - Same `TradeDecision` output schema

---

## Proposed Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SIGNAL PROCESSING LAYER                      │
│                     (New: Pre-AI Computation)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │  Market Data    │  │   Indicator     │  │    Signal       │     │
│  │   Fetcher       │──│   Calculator    │──│   Generator     │     │
│  │ (existing)      │  │  (existing)     │  │   (NEW)         │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                    │                │
│                                                    ▼                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   Coin Signal Summary                        │   │
│  │  - Trend: BULLISH/BEARISH/NEUTRAL + strength (1-10)         │   │
│  │  - Regime: TRENDING/RANGING/VOLATILE                         │   │
│  │  - Entry signals: List of aligned signals                    │   │
│  │  - Key levels: Support/resistance (calculated)               │   │
│  │  - Divergences: RSI/MACD divergence detection                │   │
│  │  - Risk score: Per-coin risk assessment                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         AI DECISION LAYER                           │
│                     (Refactored: Simplified)                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   Compact       │  │    LangChain    │  │     Zod         │     │
│  │   Prompt        │──│    Chain        │──│    Parser       │     │
│  │  (~100 lines)   │  │   (existing)    │  │   (existing)    │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                     │
│  Prompt receives pre-calculated:                                    │
│  - "BTC: BULLISH (8/10), 3 entry signals, support $94,500"         │
│  - Instead of: "[87678.00, 87700.00, 87733.00...]"                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### New Module: Signal Processor

**Location**: `convex/signals/signalProcessor.ts`

#### Data Structures

```typescript
// Trend classification
interface TrendAnalysis {
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  strength: number; // 1-10 scale
  shortTermMomentum: "ACCELERATING" | "STEADY" | "DECELERATING";
  alignment2m4h: boolean; // Are 2m and 4h trends aligned?
}

// Market regime
interface MarketRegime {
  type: "TRENDING" | "RANGING" | "VOLATILE";
  volatilityLevel: "LOW" | "NORMAL" | "HIGH" | "EXTREME";
  atrRatio: number; // ATR3/ATR14 ratio
}

// Entry signals (pre-computed)
interface EntrySignal {
  type: "RSI_OVERSOLD" | "RSI_OVERBOUGHT" | "MACD_CROSS_BULLISH" |
        "MACD_CROSS_BEARISH" | "EMA_BREAKOUT" | "HIGHER_LOW" |
        "LOWER_HIGH" | "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" |
        "VOLUME_SPIKE";
  description: string;
  strength: "WEAK" | "MODERATE" | "STRONG";
}

// Key price levels
interface KeyLevels {
  resistance: number[]; // Up to 3 levels
  support: number[]; // Up to 3 levels
  high24h: number;
  low24h: number;
  pivotPoint: number;
}

// Divergence detection
interface Divergence {
  type: "BULLISH" | "BEARISH" | null;
  indicator: "RSI" | "MACD";
  strength: "WEAK" | "MODERATE" | "STRONG";
}

// Complete coin signal summary
interface CoinSignalSummary {
  symbol: string;
  currentPrice: number;

  // Pre-calculated insights
  trend: TrendAnalysis;
  regime: MarketRegime;
  keyLevels: KeyLevels;
  entrySignals: EntrySignal[];
  divergences: Divergence[];

  // Risk assessment
  riskScore: number; // 1-10 (10 = highest risk)
  riskFactors: string[];

  // Actionable summary (for prompt)
  summary: string; // One-line human-readable summary

  // Raw data (minimal, for reference)
  rsi14: number;
  macd: number;
  macdSignal: number;
  volumeRatio: number; // Current vs average
}
```

### Signal Generation Algorithms

#### 1. Trend Analysis

```typescript
function analyzeTrend(data: DetailedCoinData): TrendAnalysis {
  // Short-term (2m): Price vs EMA20
  const priceVsEma20 = (data.currentPrice - data.ema20) / data.ema20 * 100;

  // Long-term (4h): EMA20 vs EMA50
  const ema20vs50 = (data.ema20_4h - data.ema50_4h) / data.ema50_4h * 100;

  // Direction determination
  let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  if (priceVsEma20 > 0.5 && ema20vs50 > 0.5) direction = "BULLISH";
  else if (priceVsEma20 < -0.5 && ema20vs50 < -0.5) direction = "BEARISH";
  else direction = "NEUTRAL";

  // Strength calculation (1-10)
  const strength = calculateTrendStrength(priceVsEma20, ema20vs50, data);

  // Momentum from RSI slope
  const rsiSlope = calculateSlope(data.rsi14History);
  let momentum: "ACCELERATING" | "STEADY" | "DECELERATING";
  if (Math.abs(rsiSlope) < 0.5) momentum = "STEADY";
  else if ((direction === "BULLISH" && rsiSlope > 0) ||
           (direction === "BEARISH" && rsiSlope < 0)) momentum = "ACCELERATING";
  else momentum = "DECELERATING";

  return { direction, strength, shortTermMomentum: momentum, alignment2m4h };
}
```

#### 2. Support/Resistance Detection

```typescript
function detectKeyLevels(data: DetailedCoinData): KeyLevels {
  const prices = data.priceHistory;

  // Find local highs and lows (swing points)
  const swingHighs = findSwingHighs(prices);
  const swingLows = findSwingLows(prices);

  // Cluster nearby levels (within 0.3%)
  const resistanceLevels = clusterLevels(swingHighs, data.currentPrice, "above");
  const supportLevels = clusterLevels(swingLows, data.currentPrice, "below");

  // Add 24h high/low as significant levels
  // Calculate pivot point: (H + L + C) / 3
  const pivotPoint = (data.high24h + data.low24h + data.currentPrice) / 3;

  return {
    resistance: resistanceLevels.slice(0, 3),
    support: supportLevels.slice(0, 3),
    high24h: data.high24h,
    low24h: data.low24h,
    pivotPoint,
  };
}
```

#### 3. Divergence Detection

```typescript
function detectDivergence(data: DetailedCoinData): Divergence[] {
  const prices = data.priceHistory;
  const rsi = data.rsi14History;

  const divergences: Divergence[] = [];

  // Bullish divergence: Price lower low, RSI higher low
  if (isLowerLow(prices) && isHigherLow(rsi)) {
    divergences.push({
      type: "BULLISH",
      indicator: "RSI",
      strength: calculateDivergenceStrength(prices, rsi),
    });
  }

  // Bearish divergence: Price higher high, RSI lower high
  if (isHigherHigh(prices) && isLowerHigh(rsi)) {
    divergences.push({
      type: "BEARISH",
      indicator: "RSI",
      strength: calculateDivergenceStrength(prices, rsi),
    });
  }

  return divergences;
}
```

#### 4. Entry Signal Detection

```typescript
function detectEntrySignals(data: DetailedCoinData): EntrySignal[] {
  const signals: EntrySignal[] = [];

  // RSI Oversold bounce (< 30 and rising)
  if (data.rsi14 < 30 && isRising(data.rsi14History, 2)) {
    signals.push({
      type: "RSI_OVERSOLD",
      description: `RSI14 at ${data.rsi14.toFixed(1)}, bouncing from oversold`,
      strength: data.rsi14 < 25 ? "STRONG" : "MODERATE",
    });
  }

  // MACD bullish crossover
  const prevMacd = data.macdHistory[data.macdHistory.length - 2];
  if (data.macd > 0 && prevMacd <= 0) {
    signals.push({
      type: "MACD_CROSS_BULLISH",
      description: "MACD crossed above signal line",
      strength: calculateMacdStrength(data),
    });
  }

  // EMA20 breakout with volume
  if (data.currentPrice > data.ema20 && data.volumeRatio > 1.2) {
    signals.push({
      type: "EMA_BREAKOUT",
      description: `Price broke above EMA20 with ${(data.volumeRatio * 100 - 100).toFixed(0)}% above-avg volume`,
      strength: data.volumeRatio > 1.5 ? "STRONG" : "MODERATE",
    });
  }

  // ... Additional signal types

  return signals;
}
```

### Simplified Prompt Structure

**New prompt (~120 lines vs current 486 lines)**:

```typescript
export const COMPACT_SYSTEM_PROMPT = `
You are a crypto trading AI for Hyperliquid DEX.

ACCOUNT CONFIG:
- Max Leverage: {maxLeverage}x | Max Position: {maxPositionSize}%
- Risk per Trade: {perTradeRiskPct}% | Min Confidence: {minEntryConfidence}
- Position Limits: {maxTotalPositions} total, {maxSameDirectionPositions} same direction

DECISION RULES (in priority order):
1. CHECK LIMITS - Stop if daily loss > {maxDailyLoss}% or account < ${minAccountValue}
2. MANAGE POSITIONS - Existing positions: HOLD unless invalidation triggered
3. EVALUATE SIGNALS - Need {minEntrySignals}+ aligned signals for entry
4. VALIDATE R:R - Minimum {minRiskRewardRatio}:1 required

MARKET STATE:
{preProcessedSignals}

EXISTING POSITIONS:
{currentPositions}

YOUR TASK:
Analyze the pre-processed signals and make ONE decision.
Use the provided entry signals, don't re-calculate them.
Output ONLY valid JSON matching the schema.
`;
```

**Pre-processed signal format (per coin)**:

```
BTC ($94,850):
  Trend: BULLISH (7/10), momentum ACCELERATING, 2m-4h ALIGNED
  Regime: TRENDING, volatility NORMAL (ATR ratio 1.2)
  Key Levels: Support $94,200, $93,800 | Resistance $95,500, $96,200
  Entry Signals (3): RSI_OVERSOLD (strong), MACD_CROSS_BULLISH (moderate), HIGHER_LOW
  Divergences: None
  Risk Score: 4/10
  Summary: Strong bullish setup with 3 aligned entry signals, low risk
```

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `convex/signals/signalProcessor.ts` | Main signal processing module |
| `convex/signals/trendAnalysis.ts` | Trend direction and strength calculation |
| `convex/signals/levelDetection.ts` | Support/resistance calculation |
| `convex/signals/divergenceDetection.ts` | RSI/MACD divergence detection |
| `convex/signals/entrySignals.ts` | Entry signal detection |
| `convex/signals/types.ts` | TypeScript interfaces for signals |
| `convex/ai/prompts/compactSystem.ts` | New simplified prompt (~120 lines) |

### Modified Files

| File | Changes |
|------|---------|
| `convex/trading/tradingLoop.ts` | Add signal processing step before AI call |
| `convex/ai/chains/tradingChain.ts` | Use compact prompt, new data format |
| `convex/ai/agents/tradingAgent.ts` | Accept pre-processed signals |
| `convex/hyperliquid/detailedMarketData.ts` | Add 24h high/low to data |

### Preserved Files (No Changes)

| File | Reason |
|------|--------|
| `convex/ai/parsers/tradeDecision.ts` | Parser works with existing schema |
| `convex/ai/parsers/schemas.ts` | `TradeDecision` schema unchanged |
| `convex/schema.ts` | Database schema unchanged |
| `convex/indicators/technicalIndicators.ts` | Reused by signal processor |

---

## Data Flow

### Current Flow (Inefficient)

```
1. Fetch candles (120 1m candles per coin)
2. Calculate indicators (RSI, MACD, EMA, ATR)
3. Format as arrays in prompt
4. Send 600+ line prompt to AI
5. AI re-analyzes raw data
6. AI generates decision
7. Parse JSON response
```

### New Flow (Optimized)

```
1. Fetch candles (120 1m candles per coin)
2. Calculate indicators (RSI, MACD, EMA, ATR) [existing]
3. NEW: Process signals:
   - Detect trends, strength, alignment
   - Calculate support/resistance
   - Detect divergences
   - Generate entry signals
   - Compute risk scores
4. Format as concise summaries (~20 lines per coin)
5. Send ~150 line prompt to AI
6. AI evaluates pre-calculated signals
7. AI generates decision
8. Parse JSON response
```

---

## Risk Considerations

### Risks Mitigated

1. **Signal Accuracy** - Pre-calculated signals use deterministic algorithms, reducing AI hallucination
2. **Latency** - Smaller prompt = faster API response
3. **Consistency** - Same inputs produce same signal classifications
4. **Cost** - Fewer tokens per request

### Risks Introduced

1. **Signal Logic Bugs** - Bugs in signal processor affect all decisions
   - **Mitigation**: Comprehensive unit tests, gradual rollout

2. **Over-simplification** - AI may need raw data for edge cases
   - **Mitigation**: Include minimal raw data (current RSI, MACD values)

3. **Divergence from Current Behavior** - New signals may differ from AI's internal analysis
   - **Mitigation**: A/B testing, parallel running during transition

---

## Non-Goals (Explicit Deferrals)

1. **Order Book Integration** - Requires Hyperliquid WebSocket, deferred to Phase 2
2. **Liquidation Level Heatmaps** - Requires additional API, deferred
3. **Sentiment Analysis** - Out of scope for this refactor
4. **Multi-model Ensemble** - Future enhancement
5. **Backtesting Framework** - Separate project
6. **Real-time Streaming** - Current 3-minute loop sufficient

---

## Success Criteria

1. **Prompt Size**: Reduced from 680+ lines to <150 lines
2. **Response Reliability**: JSON parse failures reduced by >80%
3. **Latency**: AI response time reduced by >30%
4. **Signal Quality**: All current signal types preserved, new ones added
5. **Backward Compatibility**: `TradeDecision` schema unchanged
6. **Test Coverage**: >80% coverage on signal processing modules

---

## Environment/Config Changes

### No New Environment Variables

All processing is server-side within Convex. No new secrets or API keys required.

### Logging Additions

```typescript
// New log entries in systemLogs table
{
  level: "INFO",
  message: "Signal processing completed",
  data: {
    symbol: "BTC",
    trend: "BULLISH",
    signalCount: 3,
    riskScore: 4,
    processingTimeMs: 45
  }
}
```

---

## Timeline Estimate

| Phase | Duration | Description |
|-------|----------|-------------|
| Phase 1 | 2-3 days | Signal processor core (trend, levels, divergences) |
| Phase 2 | 1-2 days | Entry signal detection |
| Phase 3 | 1 day | Compact prompt creation |
| Phase 4 | 1 day | Integration with trading loop |
| Phase 5 | 2 days | Testing and validation |
| **Total** | **7-9 days** | |

---

## Appendix: Current vs New Prompt Comparison

### Current (680 lines total)

```
SECTION                           LINES
────────────────────────────────────────
Trading Context                     35
Decision Framework                  32
Analysis Requirements               12
Entry Signal Requirements           24
Position Management                 62
Risk Management                     22
Position Sizing Methodology         50
Stop Loss & Take Profit            90
Confidence Calculation             20
Pre-Trade Validation               24
Output Format                       20
Trading Philosophy                  20
Market Data (per coin x 6)        ~300
────────────────────────────────────────
TOTAL                             ~690
```

### New (150 lines total)

```
SECTION                           LINES
────────────────────────────────────────
Account Config (compact)            5
Decision Rules (priority list)     15
Signal Interpretation Guide        20
Position Evaluation Rules          15
Risk Limits                        10
Output Format                      10
Pre-processed Signals (6 coins)   ~60
Position Details                  ~15
────────────────────────────────────────
TOTAL                            ~150
```
