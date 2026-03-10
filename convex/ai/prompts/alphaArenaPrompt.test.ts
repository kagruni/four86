import test from "node:test";
import assert from "node:assert/strict";

import type { DetailedCoinData } from "../../hyperliquid/detailedMarketData";
import {
  ALPHA_ARENA_SYSTEM_PROMPT_TEMPLATE,
  buildAlphaArenaDecisionTrace,
  formatMarketDataAlphaArena,
} from "./alphaArenaPrompt";

function makeCoin(overrides: Partial<DetailedCoinData> = {}): DetailedCoinData {
  const base: DetailedCoinData = {
    symbol: "BTC",
    currentPrice: 100,
    ema20: 99.73,
    macd: 0.1,
    rsi7: 58,
    rsi14: 54,
    priceHistory: [99.2, 99.4, 99.7, 99.9, 100],
    ema20History: [99.1, 99.2, 99.3, 99.5, 99.73],
    macdHistory: [0.01, 0.03, 0.06, 0.08, 0.1],
    rsi7History: [48, 50, 53, 56, 58],
    rsi14History: [46, 48, 50, 52, 54],
    ema20_1h: 100.2,
    ema50_1h: 99.9,
    priceHistory_1h: [99.2, 99.5, 99.8, 100.1, 100.4],
    ema20_4h: 100.26,
    ema50_4h: 100,
    atr3_4h: 1.2,
    atr14_4h: 1.8,
    currentVolume_4h: 1200,
    avgVolume_4h: 1000,
    macdHistory_4h: [0.02, 0.03, 0.04, 0.05, 0.06],
    rsi14History_4h: [47, 49, 50, 52, 54],
    dayOpen: 98,
    dayChangePct: 2.04,
    high24h: 101,
    low24h: 97,
    volumeRatio: 1.2,
  };

  return {
    ...base,
    ...overrides,
  };
}

test("legacy prompt trace now labels moderate aligned structure as bullish", () => {
  const trace = buildAlphaArenaDecisionTrace({
    BTC: makeCoin(),
  }, []);

  assert.equal(trace.symbols[0].trendDirection, "BULLISH");
});

test("neutral bullish-lean context uses constructive wording and new header", () => {
  const output = formatMarketDataAlphaArena(
    {
      BTC: makeCoin({
        currentPrice: 100,
        ema20: 99.95,
        priceHistory: [99.7, 99.8, 99.85, 99.95, 100],
        ema20_4h: 100.18,
        ema50_4h: 100,
      }),
    },
    1.5,
    2.0,
    {}
  );

  assert.match(output, /\[TREND SNAPSHOT\]/);
  assert.match(output, /4h structure still leans bullish/i);
  assert.doesNotMatch(output, /no directional edge/i);
});

test("system prompt no longer contains blanket mixed-regime hold wording", () => {
  assert.doesNotMatch(ALPHA_ARENA_SYSTEM_PROMPT_TEMPLATE, /If regime is mixed/i);
  assert.match(
    ALPHA_ARENA_SYSTEM_PROMPT_TEMPLATE,
    /clear continuation, pullback, or reversal edge/i
  );
});
