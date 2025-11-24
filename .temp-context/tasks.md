# AI Decision System Refactor - Task List

## Overview

This task list implements the signal processing layer and prompt simplification for the Four86 trading bot. Tasks are ordered by dependency and grouped by module.

---

## Phase 1: Signal Processing Core

### 1.1 Type Definitions

- [ ] **Create signal types module**
  - File: `convex/signals/types.ts`
  - Define interfaces: `TrendAnalysis`, `MarketRegime`, `EntrySignal`, `KeyLevels`, `Divergence`, `CoinSignalSummary`
  - Export all types for use across signal modules
  - Test: Type compilation only (no runtime tests)

### 1.2 Trend Analysis Module

- [ ] **Implement trend analysis**
  - File: `convex/signals/trendAnalysis.ts`
  - Functions:
    - `analyzeTrend(data: DetailedCoinData): TrendAnalysis`
    - `calculateTrendStrength(priceVsEma: number, emaAlignment: number, data: DetailedCoinData): number`
    - `calculateSlope(values: number[]): number`
    - `detectMomentum(rsiHistory: number[]): "ACCELERATING" | "STEADY" | "DECELERATING"`
  - Test file: `tests/signals/trendAnalysis.test.ts`
  - Test cases:
    - Strong bullish trend (price > EMA20 > EMA50)
    - Strong bearish trend (price < EMA20 < EMA50)
    - Neutral/ranging market
    - Momentum acceleration detection
    - Momentum deceleration detection

### 1.3 Support/Resistance Detection

- [ ] **Implement level detection**
  - File: `convex/signals/levelDetection.ts`
  - Functions:
    - `detectKeyLevels(data: DetailedCoinData): KeyLevels`
    - `findSwingHighs(prices: number[], lookback?: number): number[]`
    - `findSwingLows(prices: number[], lookback?: number): number[]`
    - `clusterLevels(levels: number[], currentPrice: number, direction: "above" | "below"): number[]`
    - `calculatePivotPoint(high: number, low: number, close: number): number`
  - Test file: `tests/signals/levelDetection.test.ts`
  - Test cases:
    - Detect swing highs in uptrend
    - Detect swing lows in downtrend
    - Cluster nearby levels (within 0.3%)
    - Filter levels by proximity to current price
    - Handle edge cases (no swings found)

### 1.4 Divergence Detection

- [ ] **Implement divergence detection**
  - File: `convex/signals/divergenceDetection.ts`
  - Functions:
    - `detectDivergences(data: DetailedCoinData): Divergence[]`
    - `isLowerLow(prices: number[], lookback?: number): boolean`
    - `isHigherLow(values: number[], lookback?: number): boolean`
    - `isHigherHigh(prices: number[], lookback?: number): boolean`
    - `isLowerHigh(values: number[], lookback?: number): boolean`
    - `calculateDivergenceStrength(prices: number[], indicator: number[]): "WEAK" | "MODERATE" | "STRONG"`
  - Test file: `tests/signals/divergenceDetection.test.ts`
  - Test cases:
    - Bullish RSI divergence (price LL, RSI HL)
    - Bearish RSI divergence (price HH, RSI LH)
    - No divergence present
    - Weak vs strong divergence classification

---

## Phase 2: Entry Signal Detection

### 2.1 Entry Signals Module

- [ ] **Implement entry signal detection**
  - File: `convex/signals/entrySignals.ts`
  - Functions:
    - `detectEntrySignals(data: DetailedCoinData): EntrySignal[]`
    - `detectRSISignals(data: DetailedCoinData): EntrySignal[]`
    - `detectMACDSignals(data: DetailedCoinData): EntrySignal[]`
    - `detectEMASignals(data: DetailedCoinData): EntrySignal[]`
    - `detectPriceActionSignals(data: DetailedCoinData): EntrySignal[]`
    - `detectVolumeSignals(data: DetailedCoinData): EntrySignal[]`
  - Signal types to detect:
    - RSI oversold bounce (RSI < 30 and rising)
    - RSI overbought rejection (RSI > 70 and falling)
    - RSI momentum break (RSI crosses 50)
    - MACD bullish crossover (histogram crosses above signal)
    - MACD bearish crossover (histogram crosses below signal)
    - EMA20 breakout (price crosses EMA20 with volume)
    - Higher low formation (bullish price action)
    - Lower high formation (bearish price action)
    - Volume spike (>1.5x average)
  - Test file: `tests/signals/entrySignals.test.ts`
  - Test cases:
    - Each signal type individually
    - Multiple signals simultaneously
    - No signals present
    - Signal strength classification

### 2.2 Risk Assessment

- [ ] **Implement risk scoring**
  - File: `convex/signals/riskAssessment.ts`
  - Functions:
    - `calculateRiskScore(data: DetailedCoinData, signals: EntrySignal[], regime: MarketRegime): number`
    - `identifyRiskFactors(data: DetailedCoinData, regime: MarketRegime): string[]`
  - Risk factors to consider:
    - High volatility (ATR ratio > 1.5)
    - Overbought/oversold extremes
    - Divergence present (conflicting signals)
    - Approaching major resistance/support
    - Low volume (< 0.7x average)
    - Counter-trend setup
  - Test file: `tests/signals/riskAssessment.test.ts`
  - Test cases:
    - Low risk setup (trending, aligned signals)
    - High risk setup (volatile, divergence)
    - Risk factor identification

---

## Phase 3: Signal Processor Integration

### 3.1 Main Signal Processor

- [ ] **Create main signal processor**
  - File: `convex/signals/signalProcessor.ts`
  - Functions:
    - `processSignals(data: DetailedCoinData): CoinSignalSummary`
    - `formatSignalSummary(summary: CoinSignalSummary): string`
    - `processAllCoins(marketData: Record<string, DetailedCoinData>): Record<string, CoinSignalSummary>`
  - Integration points:
    - Import from all signal modules
    - Compose full `CoinSignalSummary` object
    - Generate human-readable summary string
  - Test file: `tests/signals/signalProcessor.test.ts`
  - Test cases:
    - Full signal processing pipeline
    - Summary formatting
    - Edge cases (missing data)

### 3.2 Convex Action

- [ ] **Create Convex action for signal processing**
  - File: `convex/signals/signalProcessor.ts` (add to existing)
  - Add Convex action:
    ```typescript
    export const processMarketSignals = action({
      args: {
        detailedMarketData: v.any(),
      },
      handler: async (_ctx, args) => {
        return processAllCoins(args.detailedMarketData);
      },
    });
    ```
  - Verify action works in Convex dashboard

---

## Phase 4: Compact Prompt System

### 4.1 New Prompt Template

- [ ] **Create compact system prompt**
  - File: `convex/ai/prompts/compactSystem.ts`
  - Create `COMPACT_SYSTEM_PROMPT` (~100 lines)
  - Sections:
    - Account configuration (5 lines)
    - Decision rules priority list (15 lines)
    - Signal interpretation guide (20 lines)
    - Position management rules (15 lines)
    - Risk limits (10 lines)
    - Output format (10 lines)
  - Create `COMPACT_MARKET_DATA_PROMPT` for pre-processed signals
  - Create `formatPreProcessedSignals(signals: Record<string, CoinSignalSummary>): string`
  - Export `compactTradingPrompt = ChatPromptTemplate.fromMessages([...])`

### 4.2 Prompt Helpers Update

- [ ] **Update prompt helpers**
  - File: `convex/ai/prompts/promptHelpers.ts`
  - Add function: `generateCompactPromptVariables(config: BotConfig): CompactPromptVars`
  - Reduce variable count (only essential config)
  - Keep backward compatibility with existing `generatePromptVariables`

---

## Phase 5: Trading Chain Integration

### 5.1 New Trading Chain

- [ ] **Create compact trading chain**
  - File: `convex/ai/chains/tradingChain.ts`
  - Add function: `createCompactTradingChain(...)`
  - Use new `compactTradingPrompt`
  - Accept pre-processed signals instead of raw market data
  - Keep existing `createDetailedTradingChain` for backward compatibility

### 5.2 Trading Agent Update

- [ ] **Update trading agent**
  - File: `convex/ai/agents/tradingAgent.ts`
  - Add new action: `makeCompactTradingDecision`
  - Accept `processedSignals: Record<string, CoinSignalSummary>`
  - Use `createCompactTradingChain`
  - Keep existing `makeDetailedTradingDecision` for backward compatibility

### 5.3 Trading Loop Integration

- [ ] **Integrate into trading loop**
  - File: `convex/trading/tradingLoop.ts`
  - Add signal processing step before AI call:
    ```typescript
    // After fetching detailed market data
    const processedSignals = await ctx.runAction(
      api.signals.signalProcessor.processMarketSignals,
      { detailedMarketData }
    );
    ```
  - Switch to `makeCompactTradingDecision`
  - Add logging for signal processing time
  - Keep feature flag for rollback:
    ```typescript
    const USE_COMPACT_PROMPT = true; // Toggle for A/B testing
    ```

---

## Phase 6: Market Data Enhancements

### 6.1 Add 24h Range Data

- [ ] **Enhance market data fetcher**
  - File: `convex/hyperliquid/detailedMarketData.ts`
  - Add 24h high/low to `DetailedCoinData`:
    ```typescript
    high24h: number;
    low24h: number;
    ```
  - Fetch from Hyperliquid API or calculate from 4h candles
  - Update `getDetailedCoinData` function

### 6.2 Add Volume Ratio

- [ ] **Add volume analysis to market data**
  - File: `convex/hyperliquid/detailedMarketData.ts`
  - Add to `DetailedCoinData`:
    ```typescript
    volumeRatio: number; // currentVolume / avgVolume
    ```
  - Calculate from existing volume data

---

## Phase 7: Testing

### 7.1 Unit Tests

- [ ] **Create test fixtures**
  - File: `tests/fixtures/marketDataFixtures.ts`
  - Create realistic market data samples:
    - Bullish trending market
    - Bearish trending market
    - Ranging market
    - Volatile market
    - Market with divergence

- [ ] **Run all signal tests**
  - Command: `npm test tests/signals/`
  - Verify all tests pass
  - Target coverage: >80%

### 7.2 Integration Tests

- [ ] **Test full signal processing pipeline**
  - File: `tests/integration/signalProcessor.test.ts`
  - Test with real market data shapes
  - Verify output format matches expected schema

- [ ] **Test prompt generation**
  - File: `tests/integration/compactPrompt.test.ts`
  - Verify prompt length < 200 lines
  - Verify all template variables are populated

### 7.3 Manual Validation

- [ ] **Manual testing with real data**
  - Use `convex/testing/manualTrigger.ts`
  - Compare signals generated vs expected
  - Verify AI responses are valid JSON
  - Check decision quality (subjective)

---

## Phase 8: Cleanup and Documentation

### 8.1 Code Cleanup

- [ ] **Remove deprecated code**
  - Keep `detailedSystem.ts` for reference (rename to `detailedSystem.legacy.ts`)
  - Update imports in all files
  - Remove unused formatting functions from `detailedSystem.ts`

### 8.2 Observability

- [ ] **Add logging and metrics**
  - Log signal processing time per coin
  - Log signal counts per invocation
  - Log prompt token counts (before/after)
  - Add to `systemLogs` table

---

## MCP Actions Required

- [ ] **Verify Convex schema** - Ensure no schema changes needed for signal storage
- [ ] **Context7** - Reference Next.js patterns for TypeScript modules if needed

---

## Rollback Plan

If issues arise after deployment:

1. Set `USE_COMPACT_PROMPT = false` in `tradingLoop.ts`
2. System reverts to existing `makeDetailedTradingDecision`
3. No database changes required
4. Signal processor still runs (for logging) but decisions use old prompt

---

## Acceptance Criteria Checklist

- [ ] Prompt size reduced from 680+ lines to <150 lines
- [ ] All signal types implemented:
  - [ ] Trend analysis (direction, strength, momentum)
  - [ ] Market regime (trending/ranging/volatile)
  - [ ] Support/resistance levels
  - [ ] RSI/MACD divergence detection
  - [ ] Entry signals (RSI, MACD, EMA, volume)
  - [ ] Risk scoring
- [ ] Existing `TradeDecision` schema unchanged
- [ ] Backward compatibility maintained (old chain still works)
- [ ] Unit test coverage >80% on signal modules
- [ ] JSON parse failure rate monitored
- [ ] No new environment variables required

---

## File Summary

### New Files (11)

| File | Lines (est) |
|------|-------------|
| `convex/signals/types.ts` | ~80 |
| `convex/signals/trendAnalysis.ts` | ~120 |
| `convex/signals/levelDetection.ts` | ~150 |
| `convex/signals/divergenceDetection.ts` | ~100 |
| `convex/signals/entrySignals.ts` | ~200 |
| `convex/signals/riskAssessment.ts` | ~80 |
| `convex/signals/signalProcessor.ts` | ~150 |
| `convex/ai/prompts/compactSystem.ts` | ~150 |
| `tests/signals/trendAnalysis.test.ts` | ~150 |
| `tests/signals/levelDetection.test.ts` | ~150 |
| `tests/signals/entrySignals.test.ts` | ~200 |

### Modified Files (5)

| File | Changes |
|------|---------|
| `convex/trading/tradingLoop.ts` | Add signal processing step, feature flag |
| `convex/ai/chains/tradingChain.ts` | Add `createCompactTradingChain` |
| `convex/ai/agents/tradingAgent.ts` | Add `makeCompactTradingDecision` |
| `convex/hyperliquid/detailedMarketData.ts` | Add 24h high/low, volume ratio |
| `convex/ai/prompts/promptHelpers.ts` | Add compact prompt helpers |

---

## Task Dependencies Graph

```
[1.1 Types] ─────────┬───────────────────────────────────────────┐
                     │                                           │
[1.2 Trend] ────────┤                                           │
                     │                                           │
[1.3 Levels] ───────┤                                           │
                     ├──▶ [3.1 Signal Processor] ──▶ [5.3 Loop] │
[1.4 Divergence] ───┤                                           │
                     │                                           │
[2.1 Entry Signals]─┤                                           │
                     │                                           │
[2.2 Risk] ─────────┘                                           │
                                                                 │
[4.1 Compact Prompt] ──▶ [5.1 Chain] ──▶ [5.2 Agent] ──────────┘
                                                                 │
[6.1 24h Data] ──────────────────────────────────────────────────┘
```

---

## Estimated Effort

| Phase | Tasks | Days |
|-------|-------|------|
| Phase 1 | 4 | 2 |
| Phase 2 | 2 | 1.5 |
| Phase 3 | 2 | 1 |
| Phase 4 | 2 | 1 |
| Phase 5 | 3 | 1.5 |
| Phase 6 | 2 | 0.5 |
| Phase 7 | 4 | 2 |
| Phase 8 | 2 | 0.5 |
| **Total** | **21** | **10** |
