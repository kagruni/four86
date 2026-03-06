import type { DetailedCoinData } from "../hyperliquid/detailedMarketData";

export type PriceMomentum = "RISING" | "FALLING" | "FLAT";
export type SnapshotTrendDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface SymbolMarketSnapshot {
  symbol: string;
  currentPrice: number;
  dayOpen: number;
  dayChangePct: number;
  intraday: {
    ema20: number;
    priceVsEma20Pct: number;
    momentum: PriceMomentum;
    trendDirection: SnapshotTrendDirection;
    priceHistory: number[];
    ema20History: number[];
    macd: number;
    macdHistory: number[];
    rsi7: number;
    rsi7History: number[];
    rsi14: number;
    rsi14History: number[];
  };
  hourly: {
    ema20: number;
    ema50: number;
    trendDirection: SnapshotTrendDirection;
    priceHistory: number[];
  };
  fourHour: {
    ema20: number;
    ema50: number;
    ema20VsEma50Pct: number;
    trendDirection: SnapshotTrendDirection;
    atr3: number;
    atr14: number;
    currentVolume: number;
    avgVolume: number;
    volumeRatio: number;
    macdHistory: number[];
    rsi14History: number[];
  };
  session: {
    high24h: number;
    low24h: number;
  };
}

export interface MarketSnapshot {
  generatedAt: string;
  symbols: Record<string, SymbolMarketSnapshot>;
}

export interface MarketSnapshotSummary {
  generatedAt: string;
  symbols: Record<
    string,
    {
      currentPrice: number;
      dayChangePct: number;
      intradayMomentum: PriceMomentum;
      intradayTrend: SnapshotTrendDirection;
      hourlyTrend: SnapshotTrendDirection;
      fourHourTrend: SnapshotTrendDirection;
      priceVsEma20Pct: number;
      ema20VsEma50Pct4h: number;
    }
  >;
}

export interface DecisionContext {
  marketSnapshot: MarketSnapshot;
  marketSnapshotSummary: MarketSnapshotSummary;
}

export function calculatePriceMomentum(priceHistory: number[]): PriceMomentum {
  if (!priceHistory || priceHistory.length < 3) {
    return "FLAT";
  }

  const recentPrices = priceHistory.slice(-5);
  let upMoves = 0;
  let downMoves = 0;

  for (let i = 1; i < recentPrices.length; i += 1) {
    if (recentPrices[i] > recentPrices[i - 1]) upMoves += 1;
    else if (recentPrices[i] < recentPrices[i - 1]) downMoves += 1;
  }

  if (upMoves >= 3) return "RISING";
  if (downMoves >= 3) return "FALLING";
  return "FLAT";
}

export function calculateTrendDirection(
  firstPct: number,
  secondPct: number,
  threshold: number = 0.3
): SnapshotTrendDirection {
  if (firstPct > threshold && secondPct > threshold) return "BULLISH";
  if (firstPct < -threshold && secondPct < -threshold) return "BEARISH";
  return "NEUTRAL";
}

export function buildMarketSnapshot(
  marketData: Record<string, DetailedCoinData>
): MarketSnapshot {
  const symbols = Object.fromEntries(
    Object.entries(marketData).map(([symbol, data]) => {
      const priceVsEma20Pct = data.ema20 > 0
        ? ((data.currentPrice - data.ema20) / data.ema20) * 100
        : 0;
      const ema20VsEma50Pct4h = data.ema50_4h > 0
        ? ((data.ema20_4h - data.ema50_4h) / data.ema50_4h) * 100
        : 0;
      const ema20VsEma50Pct1h = data.ema50_1h > 0
        ? ((data.ema20_1h - data.ema50_1h) / data.ema50_1h) * 100
        : 0;

      const intradayTrend = calculateTrendDirection(priceVsEma20Pct, ema20VsEma50Pct4h);
      const hourlyTrend = calculateTrendDirection(ema20VsEma50Pct1h, ema20VsEma50Pct4h, 0.15);
      const fourHourTrend = calculateTrendDirection(ema20VsEma50Pct4h, ema20VsEma50Pct4h);

      const snapshot: SymbolMarketSnapshot = {
        symbol,
        currentPrice: data.currentPrice,
        dayOpen: data.dayOpen,
        dayChangePct: data.dayChangePct,
        intraday: {
          ema20: data.ema20,
          priceVsEma20Pct,
          momentum: calculatePriceMomentum(data.priceHistory),
          trendDirection: intradayTrend,
          priceHistory: data.priceHistory,
          ema20History: data.ema20History,
          macd: data.macd,
          macdHistory: data.macdHistory,
          rsi7: data.rsi7,
          rsi7History: data.rsi7History,
          rsi14: data.rsi14,
          rsi14History: data.rsi14History,
        },
        hourly: {
          ema20: data.ema20_1h,
          ema50: data.ema50_1h,
          trendDirection: hourlyTrend,
          priceHistory: data.priceHistory_1h,
        },
        fourHour: {
          ema20: data.ema20_4h,
          ema50: data.ema50_4h,
          ema20VsEma50Pct: ema20VsEma50Pct4h,
          trendDirection: fourHourTrend,
          atr3: data.atr3_4h,
          atr14: data.atr14_4h,
          currentVolume: data.currentVolume_4h,
          avgVolume: data.avgVolume_4h,
          volumeRatio: data.volumeRatio,
          macdHistory: data.macdHistory_4h,
          rsi14History: data.rsi14History_4h,
        },
        session: {
          high24h: data.high24h,
          low24h: data.low24h,
        },
      };

      return [symbol, snapshot];
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    symbols,
  };
}

export function summarizeMarketSnapshot(snapshot: MarketSnapshot): MarketSnapshotSummary {
  return {
    generatedAt: snapshot.generatedAt,
    symbols: Object.fromEntries(
      Object.entries(snapshot.symbols).map(([symbol, data]) => [
        symbol,
        {
          currentPrice: data.currentPrice,
          dayChangePct: data.dayChangePct,
          intradayMomentum: data.intraday.momentum,
          intradayTrend: data.intraday.trendDirection,
          hourlyTrend: data.hourly.trendDirection,
          fourHourTrend: data.fourHour.trendDirection,
          priceVsEma20Pct: data.intraday.priceVsEma20Pct,
          ema20VsEma50Pct4h: data.fourHour.ema20VsEma50Pct,
        },
      ])
    ),
  };
}
