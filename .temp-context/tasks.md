# Pre-Flight Check Panel -- Task List

Reference: `.temp-context/spec.md`

---

## Group 1: Convex Backend Action

### Task 1.1: Create `convex/preflight/preflightCheck.ts`

**File**: `convex/preflight/preflightCheck.ts` (NEW)

Create a single public Convex action `runPreFlightCheck` that aggregates all pre-flight metrics and returns a `PreFlightResult` object.

**Implementation details:**

- Add `"use node"` directive at top of file
- Import from existing modules:
  - `fetchCandlesInternal`, `extractClosePrices`, `calculateAverageVolume` from `../hyperliquid/candles`
  - `calculateRSI`, `calculateMACD` from `../indicators/technicalIndicators`
  - `action` from `../_generated/server`
  - `v` from `convex/values`
- Define TypeScript interfaces at top of file: `PreFlightMetric`, `PreFlightResult`
- Action args: `{ symbols: v.array(v.string()), testnet: v.boolean() }`

**Data fetching (all in parallel with `Promise.allSettled`):**

1. **Fear & Greed**: `fetch("https://api.alternative.me/fng/?limit=1")` -- parse `data.data[0].value` (integer 0-100), `data.data[0].value_classification` (string). On failure, return `{ value: 50, label: "Unknown" }`.

2. **BTC 4h candles** (60 candles): `fetchCandlesInternal("BTC", "4h", 60, testnet)` -- for RSI14 and MACD calculations.

3. **Volume candles** (for all symbols, 20 candles each): For each symbol in `symbols`, call `fetchCandlesInternal(symbol, "4h", 20, testnet)`. Then compute volume ratio per symbol as `currentCandle.v / avgVolume(candles, 20)`. Average all ratios.

4. **Funding rates**: Direct POST to `${baseUrl}/info` with `{ "type": "metaAndAssetCtxs" }`. Parse response as `[meta, assetCtxs]`. Find BTC index via `meta.universe.findIndex(a => a.name === "BTC")`. Extract `parseFloat(assetCtxs[btcIndex].funding)`. This is the hourly rate. On failure, return `null`.

**Metric computation:**

- **Fear & Greed scoring**: value 25-75 -> score 100; 15-25 or 75-85 -> score 50; <15 or >85 -> score 0. Interpolate linearly within bands.
- **Volume Ratio scoring**: avg ratio > 0.5 -> score 100; 0.2-0.5 -> linearly scale 0-100; < 0.2 -> score 0.
- **BTC RSI scoring**: RSI 35-65 -> score 100; 25-35 or 65-75 -> score 50 (interpolate); < 25 or > 75 -> score 0.
- **BTC MACD direction**: Compute MACD for BTC 4h data. Get last 3 histogram values (`macd - signal`). Compare: improving (h[-1] > h[-2]) = score 100; flat (abs diff < 10% of abs(h[-2])) = score 50; worsening = score 0.
- **Funding Rate scoring**: Parse hourly funding rate. Multiply by 100 for percentage. abs < 0.01 -> score 100; 0.01-0.03 -> score 50; > 0.03 -> score 0.
- **Trading Session scoring**: Use `Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', minute: 'numeric', hour12: false })` to get current CET hour/minute. Classify per spec thresholds. Also compute `bestTimeHint` string.

**Overall score**: Weighted sum: fearGreed * 0.20 + volume * 0.25 + rsi * 0.15 + macd * 0.15 + funding * 0.10 + session * 0.15. Status: >= 65 green, >= 35 yellow, < 35 red.

**Error handling**: Each metric fetch is independent. If one fails, that metric gets status "yellow", score 50, value "Unavailable". The action never throws -- it always returns a result.

**Console logging**: Log timing for each fetch and the final computed score.

**Estimated lines**: ~350

**Test notes**: Create `tests/preflight/preflightCheck.test.ts` with unit tests for the scoring functions (extract them as pure helper functions at module level). Test: green/yellow/red classification for each metric, overall score weighting, session detection for various CET hours, edge cases (API returning null/error).

---

## Group 2: React Component

### Task 2.1: Create `components/preflight/PreFlightPanel.tsx`

**File**: `components/preflight/PreFlightPanel.tsx` (NEW)

Create the pre-flight check panel component.

**Props:**
```typescript
interface PreFlightPanelProps {
  symbols: string[];
  testnet: boolean;
}
```

**State management:**
- `const runPreFlight = useAction(api.preflight.preflightCheck.runPreFlightCheck);`
- `const [result, setResult] = useState<PreFlightResult | null>(null);`
- `const [isLoading, setIsLoading] = useState(false);`
- `const [error, setError] = useState<string | null>(null);`
- Auto-fetch on mount via `useEffect` (run once when component mounts)

**Layout (inside a `Card` from Shadcn):**

1. **Header row** (`CardHeader`):
   - Left: "Pre-Flight Check" title (h3, `text-gray-900 font-semibold`) + subtitle "Market conditions assessment"
   - Right: Overall score as large bold number (`text-3xl font-mono font-bold tabular-nums`) with status text below ("Good" / "Fair" / "Poor")
   - Far right: Refresh button (`Button variant="outline" size="sm"`) with `RefreshCw` icon, disabled while loading

2. **Metric rows** (`CardContent`):
   - 6 rows, each in a flex container with:
     - Icon (lucide-react, `h-4 w-4 text-gray-500`): `Gauge` for Fear & Greed, `BarChart3` for Volume, `TrendingUp` for RSI, `Activity` for MACD, `Percent` for Funding, `Clock` for Session
     - Metric name (`text-sm font-medium text-gray-900`)
     - Current value (`text-sm font-mono tabular-nums text-gray-700`)
     - Status indicator: a small Badge from Shadcn
       - Green: `className="bg-gray-900 text-white"` text "Good"
       - Yellow: `className="bg-gray-200 text-gray-700 border border-gray-300"` text "Fair"
       - Red: `className="bg-white text-gray-900 border-2 border-gray-900"` text "Poor"
     - Brief explanation (`text-xs text-gray-500`, truncated if needed)
   - Use `Separator` between rows

3. **Footer** (`CardContent` bottom section):
   - "Best time to start" hint: `Clock` icon + `bestTimeHint` text (`text-sm text-gray-500`)
   - Timestamp of last check (`text-xs text-gray-400`)

**Loading state**: Show `Skeleton` components for each row while loading. Show `Loader2 animate-spin` in the score area.

**Error state**: Show error message with retry button inside an `Alert` component.

**Animations**: Wrap in `motion.div` with `initial={{ opacity: 0, y: 20 }}` `animate={{ opacity: 1, y: 0 }}` matching the dashboard's existing animation pattern.

**Imports to use:**
- `Card, CardContent, CardHeader, CardTitle` from `@/components/ui/card`
- `Button` from `@/components/ui/button`
- `Badge` from `@/components/ui/badge`
- `Separator` from `@/components/ui/separator`
- `Skeleton` from `@/components/ui/skeleton`
- `Alert, AlertDescription` from `@/components/ui/alert`
- Icons from `lucide-react`: `RefreshCw, Loader2, Gauge, BarChart3, TrendingUp, Activity, Percent, Clock, AlertCircle`
- `motion` from `framer-motion`
- `useAction` from `convex/react`
- `api` from `@/convex/_generated/api`

**Estimated lines**: ~300

**Test notes**: Tests in `tests/preflight/PreFlightPanel.test.tsx` -- test rendering with mock data, loading state, error state, correct badge classes for each status.

---

## Group 3: Dashboard Integration

### Task 3.1: Integrate PreFlightPanel into dashboard page

**File**: `app/(dashboard)/dashboard/page.tsx` (MODIFY)

**Changes:**

1. **Add import** at top of file (around line 41, after existing imports):
   ```typescript
   import PreFlightPanel from "@/components/preflight/PreFlightPanel";
   ```

2. **Add conditional rendering** after the Circuit Breaker section (approximately after line 600, after the closing `</motion.div>` of the circuit breaker card) and before the KPI cards grid. Insert:
   ```tsx
   {/* Pre-Flight Check - shown only when bot is inactive */}
   {!isBotActive && botConfig && (
     <PreFlightPanel
       symbols={botConfig.symbols || ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"]}
       testnet={userCredentials?.hyperliquidTestnet ?? true}
     />
   )}
   ```

3. The panel renders only when `!isBotActive` and `botConfig` is loaded. It passes the user's configured symbols and testnet flag.

**No other changes to the dashboard file.**

**Test notes**: Verify in browser that:
- Panel appears when bot is INACTIVE
- Panel disappears when bot is ACTIVE
- Refresh button works
- All 6 metrics render with correct statuses
- Loading skeleton shows on initial load
- The panel sits between circuit breaker and KPI cards

---

## Group 4: Verification

### Task 4.1: End-to-end manual verification

- Start the dev server (`bun run dev` + `npx convex dev`)
- Navigate to the dashboard with bot INACTIVE
- Verify the PreFlightPanel loads and displays all 6 metrics
- Click Refresh and verify it re-fetches
- Toggle bot to ACTIVE and verify the panel disappears
- Toggle bot back to INACTIVE and verify the panel reappears
- Check Convex dashboard logs for the action execution timing
- Verify no console errors in the browser

---

## File Summary

| File | Action | Est. Lines |
|------|--------|------------|
| `convex/preflight/preflightCheck.ts` | NEW | ~350 |
| `components/preflight/PreFlightPanel.tsx` | NEW | ~300 |
| `app/(dashboard)/dashboard/page.tsx` | MODIFY (add ~10 lines) | ~1346 |
| `tests/preflight/preflightCheck.test.ts` | NEW (test) | ~150 |
| `tests/preflight/PreFlightPanel.test.tsx` | NEW (test) | ~100 |

## Dependency Order

```
Task 1.1 (backend action)
    |
    v
Task 2.1 (React component) -- depends on action being registered in Convex API
    |
    v
Task 3.1 (dashboard integration) -- depends on component existing
    |
    v
Task 4.1 (verification) -- depends on all above
```

Tasks 1.1 and 2.1 can be built in parallel if the builder stubs the action type, but for clean builds they should be sequential.
