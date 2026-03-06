"use node";

/**
 * Pre-Flight Check Action -- aggregates market readiness signals into a
 * single score: Fear & Greed, volume ratios, BTC RSI/MACD, funding rates,
 * and trading session timing.
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { fetchCandlesInternal, extractClosePrices, calculateAverageVolume } from "../hyperliquid/candles";
import type { Candle } from "../hyperliquid/candles";
import { calculateRSI, calculateMACD } from "../indicators/technicalIndicators";

// -- Types ------------------------------------------------------------------

type MetricStatus = "green" | "yellow" | "red";

export interface PreFlightMetric {
  name: string;
  value: string;
  numericValue: number;
  status: MetricStatus;
  explanation: string;
  score: number;
}

export interface PreFlightResult {
  overallScore: number;
  overallStatus: MetricStatus;
  metrics: {
    fearGreed: PreFlightMetric;
    volumeRatio: PreFlightMetric;
    btcRsi: PreFlightMetric;
    btcMacd: PreFlightMetric;
    fundingRate: PreFlightMetric;
    tradingSession: PreFlightMetric;
  };
  bestTimeHint: string;
  timestamp: number;
}

// -- Scoring helpers (pure, exported for testing) ---------------------------

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function scoreFearGreed(value: number): { score: number; status: MetricStatus } {
  if (value >= 25 && value <= 75) return { score: 100, status: "green" };
  if (value >= 15 && value < 25) return { score: clamp(((value - 15) / 10) * 100), status: "yellow" };
  if (value > 75 && value <= 85) return { score: clamp(((85 - value) / 10) * 100), status: "yellow" };
  return { score: 0, status: "red" };
}

export function scoreVolumeRatio(ratio: number): { score: number; status: MetricStatus } {
  if (ratio > 0.5) return { score: 100, status: "green" };
  if (ratio >= 0.2) return { score: clamp(((ratio - 0.2) / 0.3) * 100), status: "yellow" };
  return { score: 0, status: "red" };
}

export function scoreRSI(rsi: number): { score: number; status: MetricStatus } {
  if (rsi >= 35 && rsi <= 65) return { score: 100, status: "green" };
  if (rsi >= 25 && rsi < 35) return { score: clamp(((rsi - 25) / 10) * 100), status: "yellow" };
  if (rsi > 65 && rsi <= 75) return { score: clamp(((75 - rsi) / 10) * 100), status: "yellow" };
  return { score: 0, status: "red" };
}

export function scoreMACDDirection(
  histograms: [number, number, number],
): { score: number; status: MetricStatus; direction: string } {
  const [, h2, h3] = histograms;
  const absPrev = Math.abs(h2) || 1e-10;
  if (Math.abs(h3 - h2) / absPrev < 0.1) return { score: 50, status: "yellow", direction: "Flat" };
  if (h3 > h2) return { score: 100, status: "green", direction: "Improving" };
  return { score: 0, status: "red", direction: "Worsening" };
}

export function scoreFundingRate(ratePercent: number): { score: number; status: MetricStatus } {
  const a = Math.abs(ratePercent);
  if (a < 0.01) return { score: 100, status: "green" };
  if (a <= 0.03) return { score: 50, status: "yellow" };
  return { score: 0, status: "red" };
}

export function scoreTradingSession(now?: Date): {
  score: number; status: MetricStatus; bestTimeHint: string; label: string;
} {
  const date = now ?? new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const min = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const t = hour + min / 60;

  if (t >= 14.5 && t < 17) {
    return { score: 100, status: "green", bestTimeHint: "EU/US overlap now -- best time to trade", label: "EU/US Overlap" };
  }
  if (t >= 8 && t < 14.5) {
    const d = 14.5 - t, h = Math.floor(d), m = Math.round((d - h) * 60);
    return { score: 50, status: "yellow", bestTimeHint: `EU session active, overlap in ~${h}h${m > 0 ? ` ${m}m` : ""}`, label: "EU Session" };
  }
  if (t >= 17 && t < 22) {
    return { score: 50, status: "yellow", bestTimeHint: "US session active", label: "US Session" };
  }
  const d = t >= 22 ? (24 - t) + 8 : 8 - t;
  const h = Math.floor(d), m = Math.round((d - h) * 60);
  return { score: 0, status: "red", bestTimeHint: `Dead zone -- next session starts in ~${h}h${m > 0 ? ` ${m}m` : ""}`, label: "Dead Zone" };
}

// -- Internal helpers -------------------------------------------------------

function unavailable(name: string, reason: string): PreFlightMetric {
  return { name, value: "Unavailable", numericValue: 0, status: "yellow", explanation: reason, score: 50 };
}

function getLastThreeHistograms(prices: number[]): [number, number, number] | null {
  if (prices.length < 37) return null; // 26 + 9 + 2 extra for slicing
  const h3 = calculateMACD(prices);
  const h2 = calculateMACD(prices.slice(0, -1));
  const h1 = calculateMACD(prices.slice(0, -2));
  if (h1.histogram === -1 || h2.histogram === -1 || h3.histogram === -1) return null;
  return [h1.histogram, h2.histogram, h3.histogram];
}

const EXPLANATIONS: Record<string, Record<MetricStatus, string>> = {
  fearGreed: {
    green: "Neutral sentiment -- favorable for trading",
    yellow: "Sentiment slightly extreme -- proceed with caution",
    red: "Extreme sentiment -- high risk environment",
  },
  rsi: {
    green: "RSI in neutral zone -- no overbought/oversold signal",
    yellow: "RSI approaching extreme -- monitor closely",
    red: "RSI at extreme level -- high reversal risk",
  },
  volume: {
    green: "Volume above average -- strong market participation",
    yellow: "Volume moderate -- acceptable liquidity",
    red: "Volume below average -- thin liquidity risk",
  },
  funding: {
    green: "Funding rate neutral -- balanced market",
    yellow: "Funding rate slightly elevated -- minor directional bias",
    red: "Funding rate extreme -- strong directional crowding",
  },
  session: {
    green: "Peak liquidity window -- optimal for trading",
    yellow: "Active session -- decent liquidity",
    red: "Off-hours -- low liquidity and wider spreads",
  },
};

// -- Main action ------------------------------------------------------------

export const runPreFlightCheck = action({
  args: { symbols: v.array(v.string()), testnet: v.boolean() },
  handler: async (_ctx, args): Promise<PreFlightResult> => {
    const { symbols, testnet } = args;
    const start = Date.now();
    const baseUrl = testnet ? "https://api.hyperliquid-testnet.xyz" : "https://api.hyperliquid.xyz";

    // Parallel data fetches
    const t0 = Date.now();
    const [fgRes, btcRes, volRes, fundRes] = await Promise.allSettled([
      // 1) Fear & Greed
      (async () => {
        const ts = Date.now();
        const res = await fetch("https://api.alternative.me/fng/?limit=1");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(`[preflight] Fear & Greed fetched in ${Date.now() - ts}ms`);
        return { value: parseInt(data.data[0].value, 10), label: data.data[0].value_classification as string };
      })(),
      // 2) BTC 4h candles (60)
      (async () => {
        const ts = Date.now();
        const c = await fetchCandlesInternal("BTC", "4h", 60, testnet);
        console.log(`[preflight] BTC 4h candles (${c.length}) fetched in ${Date.now() - ts}ms`);
        return c;
      })(),
      // 3) Volume candles per symbol (20 each)
      (async () => {
        const ts = Date.now();
        const results = await Promise.allSettled(symbols.map((s) => fetchCandlesInternal(s, "4h", 20, testnet)));
        console.log(`[preflight] Volume candles for ${symbols.length} symbols fetched in ${Date.now() - ts}ms`);
        return results.map((r, i) => ({ symbol: symbols[i], candles: r.status === "fulfilled" ? r.value : [] as Candle[] }));
      })(),
      // 4) Funding rates
      (async () => {
        const ts = Date.now();
        const res = await fetch(`${baseUrl}/info`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "metaAndAssetCtxs" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(`[preflight] Funding rates fetched in ${Date.now() - ts}ms`);
        const meta = data[0], assetCtxs = data[1];
        const idx = meta.universe.findIndex((a: { name: string }) => a.name === "BTC");
        if (idx === -1) throw new Error("BTC not found in meta.universe");
        return parseFloat(assetCtxs[idx].funding);
      })(),
    ]);
    console.log(`[preflight] All fetches completed in ${Date.now() - t0}ms`);

    // --- Build metrics ---

    // Fear & Greed
    let fearGreed: PreFlightMetric;
    if (fgRes.status === "fulfilled") {
      const { value, label } = fgRes.value;
      const s = scoreFearGreed(value);
      fearGreed = { name: "Fear & Greed Index", value: `${value} (${label})`, numericValue: value, ...s, explanation: EXPLANATIONS.fearGreed[s.status] };
    } else {
      console.error("[preflight] Fear & Greed failed:", fgRes.reason);
      fearGreed = unavailable("Fear & Greed Index", "Could not fetch Fear & Greed data");
    }

    // BTC RSI + MACD
    let btcRsi: PreFlightMetric;
    let btcMacd: PreFlightMetric;
    if (btcRes.status === "fulfilled") {
      const closePrices = extractClosePrices(btcRes.value);
      // RSI
      const rsi = calculateRSI(closePrices, 14);
      if (rsi === -1) {
        btcRsi = unavailable("BTC RSI (4h)", "Insufficient candle data for RSI");
      } else {
        const s = scoreRSI(rsi);
        btcRsi = { name: "BTC RSI (4h)", value: rsi.toFixed(1), numericValue: rsi, ...s, explanation: EXPLANATIONS.rsi[s.status] };
      }
      // MACD
      const hists = getLastThreeHistograms(closePrices);
      if (!hists) {
        btcMacd = unavailable("BTC MACD (4h)", "Insufficient candle data for MACD");
      } else {
        const s = scoreMACDDirection(hists);
        const latest = hists[2];
        btcMacd = {
          name: "BTC MACD (4h)", value: `${latest >= 0 ? "+" : ""}${latest.toFixed(2)} (${s.direction})`,
          numericValue: latest, score: s.score, status: s.status,
          explanation: s.direction === "Improving" ? "MACD histogram improving -- bullish momentum" : s.direction === "Flat" ? "MACD histogram flat -- no clear momentum" : "MACD histogram worsening -- bearish momentum",
        };
      }
    } else {
      console.error("[preflight] BTC candles failed:", btcRes.reason);
      btcRsi = unavailable("BTC RSI (4h)", "Could not fetch BTC candle data");
      btcMacd = unavailable("BTC MACD (4h)", "Could not fetch BTC candle data");
    }

    // Volume Ratio
    let volumeRatio: PreFlightMetric;
    if (volRes.status === "fulfilled") {
      const ratios: number[] = [];
      for (const { candles } of volRes.value) {
        if (candles.length < 2) continue;
        const avg = calculateAverageVolume(candles, candles.length);
        if (avg <= 0) continue;
        ratios.push(candles[candles.length - 1].v / avg);
      }
      if (ratios.length === 0) {
        volumeRatio = unavailable("Volume Ratio", "No valid volume data across symbols");
      } else {
        const avgR = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        const s = scoreVolumeRatio(avgR);
        volumeRatio = { name: "Volume Ratio", value: avgR.toFixed(2), numericValue: avgR, ...s, explanation: EXPLANATIONS.volume[s.status] };
      }
    } else {
      console.error("[preflight] Volume candles failed:", volRes.reason);
      volumeRatio = unavailable("Volume Ratio", "Could not fetch volume data");
    }

    // Funding Rate
    let fundingRate: PreFlightMetric;
    if (fundRes.status === "fulfilled") {
      const pct = fundRes.value * 100;
      const s = scoreFundingRate(pct);
      fundingRate = { name: "BTC Funding Rate", value: `${pct >= 0 ? "+" : ""}${pct.toFixed(4)}%/h`, numericValue: pct, ...s, explanation: EXPLANATIONS.funding[s.status] };
    } else {
      console.error("[preflight] Funding failed:", fundRes.reason);
      fundingRate = unavailable("BTC Funding Rate", "Could not fetch funding rate data");
    }

    // Trading Session
    const sess = scoreTradingSession();
    const tradingSession: PreFlightMetric = {
      name: "Trading Session", value: sess.label, numericValue: sess.score,
      status: sess.status, explanation: EXPLANATIONS.session[sess.status], score: sess.score,
    };

    // --- Overall score ---
    const overallScore = Math.round(
      fearGreed.score * 0.20 + volumeRatio.score * 0.25 + btcRsi.score * 0.15 +
      btcMacd.score * 0.15 + fundingRate.score * 0.10 + tradingSession.score * 0.15,
    );
    const overallStatus: MetricStatus = overallScore >= 65 ? "green" : overallScore >= 35 ? "yellow" : "red";

    console.log(`[preflight] Complete. Score: ${overallScore} (${overallStatus}). Total: ${Date.now() - start}ms`);

    return {
      overallScore, overallStatus,
      metrics: { fearGreed, volumeRatio, btcRsi, btcMacd, fundingRate, tradingSession },
      bestTimeHint: sess.bestTimeHint, timestamp: Date.now(),
    };
  },
});
