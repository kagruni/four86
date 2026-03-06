# Pre-Flight Check Panel -- Specification

## Problem

The user currently has no quick way to assess whether market conditions are favorable before starting the trading bot. They must mentally synthesize Fear & Greed data, volume, RSI, MACD, funding rates, and time-of-day across multiple assets. This feature adds a single glanceable panel that aggregates all of these signals into a "Market Readiness Score" with per-metric traffic-light statuses.

## Scope

1. **New Convex action** (`convex/preflight/preflightCheck.ts`) -- a single public action the frontend can call to receive all pre-flight metrics in one shot.
2. **New React component** (`components/preflight/PreFlightPanel.tsx`) -- a self-contained panel rendered on the dashboard when the bot is INACTIVE.
3. **Dashboard integration** -- import and render the panel in `app/(dashboard)/dashboard/page.tsx` between the circuit-breaker section and the KPI cards, gated by `!isBotActive`.

## Data Flow

```
Frontend (useAction) --> convex/preflight/preflightCheck.ts
  |-- fetch Fear & Greed from alternative.me API
  |-- fetch 4h candles for BTC & ETH (60 candles each) via fetchCandlesInternal
  |-- fetch 4h candles for all 6 symbols (20 candles each) for volume ratios
  |-- fetch metaAndAssetCtxs from Hyperliquid info API for funding rates
  |-- compute RSI14 (4h) for BTC & ETH
  |-- compute MACD (4h) for BTC, derive direction from last 3 histogram values
  |-- compute volume ratios for all symbols, average them
  |-- compute trading session from current UTC hour (CET = Europe/Berlin)
  |-- compute per-metric scores and overall Market Readiness Score
  <-- return PreFlightResult
```

## Backend Touchpoints

### Existing code reused (NOT modified)

- `convex/hyperliquid/candles.ts` -- `fetchCandlesInternal`, `extractClosePrices`, `calculateAverageVolume` (internal helpers, callable from any Convex action in the same runtime)
- `convex/indicators/technicalIndicators.ts` -- `calculateRSI`, `calculateMACD` (pure functions)

### New file

- `convex/preflight/preflightCheck.ts` -- public action `runPreFlightCheck`
  - Directive: `"use node"`
  - Args: `{ symbols: v.array(v.string()), testnet: v.boolean() }`
  - Returns: `PreFlightResult` (see Data Model below)

### Why a new file instead of extending existing

- The pre-flight check is a distinct read-only feature with its own aggregation logic and scoring.
- `client.ts` is already 584 lines with trading operations.
- `detailedMarketData.ts` serves the trading loop with different data shape.
- A dedicated `convex/preflight/` folder keeps feature boundaries clean.

## Data Model

No new database tables needed. This is a read-only, compute-on-demand feature.

### PreFlightResult (return type of the action)

```typescript
interface PreFlightMetric {
  name: string;
  value: string;           // Human-readable current value (e.g., "54 (Neutral)")
  numericValue: number;    // Raw number for score computation
  status: "green" | "yellow" | "red";
  explanation: string;     // Brief one-liner explaining the status
  score: number;           // 0-100 normalized score for this metric
}

interface PreFlightResult {
  overallScore: number;    // 0-100 Market Readiness Score
  overallStatus: "green" | "yellow" | "red";
  metrics: {
    fearGreed: PreFlightMetric;
    volumeRatio: PreFlightMetric;
    btcRsi: PreFlightMetric;
    btcMacd: PreFlightMetric;
    fundingRate: PreFlightMetric;
    tradingSession: PreFlightMetric;
  };
  bestTimeHint: string;    // e.g., "EU/US overlap starts in 2h"
  timestamp: number;
}
```

## Metric Thresholds & Scoring

| Metric | Green (score 100) | Yellow (score 50) | Red (score 0) | Weight |
|--------|-------------------|-------------------|---------------|--------|
| Fear & Greed | 25-75 | 15-25 or 75-85 | <15 or >85 | 20% |
| Volume Ratio (avg across symbols) | >0.5 | 0.2-0.5 | <0.2 | 25% |
| BTC RSI14 (4h) | 35-65 | 25-35 or 65-75 | <25 or >75 | 15% |
| BTC MACD (4h) direction | Improving (histogram growing) | Flat | Worsening (histogram shrinking) | 15% |
| Funding Rate (BTC) | abs < 0.01% | 0.01%-0.03% | abs > 0.03% | 10% |
| Trading Session | EU/US overlap 14:30-17:00 CET | EU (08-14:30) or US (17-22 CET) | Dead zone (22-08 CET) | 15% |

Overall score = weighted sum of metric scores. Overall status: green >= 65, yellow >= 35, red < 35.

## Trading Session Logic

CET is handled via `Intl.DateTimeFormat` with `timeZone: "Europe/Berlin"` (automatically handles CET/CEST transitions). The action extracts the current hour and minute in Berlin time and classifies:

- **Green** (EU/US overlap): 14:30 - 17:00 CET
- **Yellow** (Active session): 08:00 - 14:30 CET or 17:00 - 22:00 CET
- **Red** (Dead zone): 22:00 - 08:00 CET

The `bestTimeHint` field provides guidance like:
- "EU/US overlap now -- best time to trade"
- "EU session active, overlap in ~2h"
- "Dead zone -- next session starts in ~4h"

## Funding Rate Extraction

The Hyperliquid `metaAndAssetCtxs` endpoint returns `[meta, assetCtxs[]]`. Each element in `assetCtxs` has a `funding` field (string, representing the hourly rate). The meta object has `universe` with asset names at matching indices. The action will call the Hyperliquid info API directly (POST to `https://api.hyperliquid.xyz/info` or testnet variant with `{"type": "metaAndAssetCtxs"}`) rather than importing from the SDK, to keep the action self-contained and avoid SDK coupling.

## MACD Direction Logic

Fetch the last 3 MACD histogram values from the 4h candle data. Classification:
- **Improving**: histogram[-1] > histogram[-2] > histogram[-3], or histogram[-1] > histogram[-2] and histogram rising by > 10% of abs(histogram[-2])
- **Flat**: abs(histogram[-1] - histogram[-2]) < 10% of abs(histogram[-2])
- **Worsening**: histogram[-1] < histogram[-2] < histogram[-3], or clear downward trend

## Component Design

The `PreFlightPanel` renders inside a `Card` component with:

1. **Header row**: "Pre-Flight Check" title + overall score as a large number + Refresh button
2. **6-row metric grid**: Each row shows icon, metric name, value, colored dot (green/yellow/red), explanation
3. **Bottom hint**: "Best time to start" text
4. All text in `text-gray-900`, monospaced numbers with `font-mono tabular-nums`
5. Status dots: `bg-black` for green, `bg-gray-400` for yellow, `bg-gray-200 border border-gray-300` for red (staying within B&W theme -- or use subtle fills: green = solid black, yellow = gray-500, red = gray-300 outline)

Actually, for the traffic light within a B&W theme, we should use semantic indicators:
- **Green**: Black filled circle + "Good" badge text
- **Yellow**: Gray filled circle + "Fair" badge text
- **Red**: Hollow circle (outline only) + "Poor" badge text

The overall score uses a circular gauge or simply a large bold number with a status text beneath.

## Constraints

- Black & white theme, Shadcn UI components, lucide-react icons only
- `text-gray-900` for text, `Loader2` for loading states
- Files under 2000 lines
- No new npm dependencies
- The action must be efficient: all external fetches run in parallel
- Component should be under 400 lines
- Only visible when bot `isActive === false`

## Risks

- **Hyperliquid API latency**: The action fetches candles for multiple symbols + metaAndAssetCtxs. Mitigated by parallel fetches and fetching only 20-60 4h candles per symbol (small payloads).
- **Fear & Greed API downtime**: alternative.me occasionally goes down. Mitigated by treating null response as "unknown" (yellow status, score 50).
- **CET/CEST detection**: JavaScript `Intl` API handles DST via `Europe/Berlin` timezone. Convex `"use node"` actions have full `Intl` support.
- **Action timeout**: Convex actions have a default timeout. Multiple parallel API calls should complete well within limits (each call is ~1-3s).

## Non-Goals (Deferred)

- Persisting pre-flight results to the database
- Auto-scheduling bot start based on readiness score
- Historical readiness score tracking/charting
- Per-symbol detailed pre-flight breakdown
- Push notifications when score transitions to green
- ETH-specific RSI/MACD display (ETH RSI is computed for potential future use but not shown in MVP)

## Env/Config Changes

None. All APIs used are public (no keys needed):
- `https://api.alternative.me/fng/?limit=1` (Fear & Greed)
- Hyperliquid info endpoint (candles + metaAndAssetCtxs)

## Observability

- Console logging in the Convex action: timing per external fetch, any errors, final score
- Errors in individual metric fetches do NOT fail the entire action -- they produce a "yellow/unknown" status for that metric
- Frontend shows error state with retry option if the entire action throws
