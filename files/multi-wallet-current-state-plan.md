# Multi-Wallet Copy Trading Plan (Current-State Rewrite)

## Goal
Add multi-wallet copy trading to the current application while preserving the behavior that already exists today:

1. One account-level strategy loop still makes one trading decision at a time.
2. That decision can be copied across multiple active Hyperliquid wallets.
3. Telegram reads, streaming, summaries, and trade notifications stay pinned to one designated main wallet.
4. The UI shows one wallet at a time, but manual symbol close closes that symbol across all active wallets.
5. Existing hybrid candidate selection, managed exits, trailing logic, settlement resolution, diagnostics, and analytics continue to work.

## Current-State Evaluation
The old plan is directionally right, but it was written before several important parts of the system existed.

### What the old plan still gets right
- The app is still single-wallet at the data and execution layers.
- `userCredentials` is the only wallet source today.
- `positions`, `trades`, `symbolTradeLocks`, Telegram settings, live queries, and dashboard reads are all keyed only by `userId`.
- Manual close is duplicated in several places and should be centralized before multi-wallet rollout.

### What the old plan now misses
- Hybrid selection is now a first-class part of the trading loop and uses current positions, open orders, recent trades, and account state to build candidate sets.
- Managed exits and trailing stop updates run independently from the trading loop and operate off persisted position runtime fields.
- Position reconciliation writes synthetic close trades when positions disappear from the exchange.
- Analytics and daily P&L use `accountSnapshots`, which the old plan did not include.
- Trade debug export assumes roughly one trade per AI decision; multi-wallet fan-out will break that unless we add grouping metadata.
- The dashboard currently calls raw Hyperliquid actions from the client using the single exposed wallet address, which does not scale to wallet selection.
- Telegram already has periodic position updates, daily summaries, confirm flows, and notifier actions that need wallet routing, not just command reads.
- There are existing debug, diagnostic, migration, and recovery pages/actions that also assume one wallet.

## Locked Product Decisions For The Rewrite
1. `botConfig` stays account-level. Wallets inherit the same strategy and risk settings.
2. `connectedWallets.isPrimary` becomes the strategy source wallet and default wallet fallback.
3. The AI still makes one account-level decision per cycle.
4. Open and close execution fans out per active wallet, best effort.
5. Manual symbol close and close-all do not update circuit-breaker loss state.
6. Managed exits, position sync, snapshots, and wallet drift handling run per wallet.
7. Telegram trade reads and trade notifications are main-wallet only. Risk alerts remain account-level.
8. Dashboard and analytics become wallet-scoped with a selector. Manual symbol close remains global across active wallets.

## Revised Implementation Plan

### Phase 1: Schema And Migration
Add `connectedWallets` and make wallet identity explicit everywhere state is persisted.

#### Schema changes
- Add `connectedWallets` with:
  - `userId`
  - `label`
  - `hyperliquidAddress`
  - `hyperliquidPrivateKey`
  - `hyperliquidTestnet`
  - `isActive`
  - `isPrimary`
  - `createdAt`
  - `updatedAt`
- Add `walletId` to:
  - `positions`
  - `trades`
  - `symbolTradeLocks`
  - `accountSnapshots`
- Add `telegramMainWalletId` to `telegramSettings`.
- Add optional `executionGroupId` to `trades` so one AI/manual decision can be linked to multiple wallet executions.
- Add indexes:
  - `connectedWallets.by_userId`
  - `connectedWallets.by_userId_active`
  - `connectedWallets.by_userId_primary`
  - `positions.by_userId_walletId`
  - `positions.by_userId_walletId_symbol`
  - `trades.by_userId_walletId_time`
  - `accountSnapshots.by_userId_walletId_time`
  - `symbolTradeLocks.by_userId_walletId_symbol`

#### Migration
- Create a multi-wallet migration action under `convex/migrations`.
- For each user with legacy Hyperliquid credentials:
  - create one `connectedWallets` row with `isPrimary=true`, `isActive=true`
  - set `telegramSettings.telegramMainWalletId` if Telegram settings exist
  - backfill `positions.walletId`, `trades.walletId`, and `accountSnapshots.walletId`
- Keep `userCredentials` readable as legacy fallback during rollout.
- Extend the existing migration/diagnostic surface rather than inventing a new admin-only path.

### Phase 2: Wallet Resolution And Strategy State
Create a wallet-resolution layer instead of scattering `userCredentials` lookups.

#### New wallet resolver module
Create `convex/wallets/resolver.ts` with helpers for:
- `getConnectedWallets(userId)`
- `getActiveConnectedWallets(userId)`
- `getWalletById(userId, walletId)`
- `getPrimaryWallet(userId)`
- `getTelegramMainWallet(userId)`
- `resolveSelectedWallet(userId, walletId)`

#### Strategy-state resolver
Create a second helper that produces the state used by hybrid selection and the AI:
- `strategyWallet`: primary wallet or fallback active wallet
- `executionWallets`: all active wallets
- `strategyAccountState`: from the primary wallet
- `strategyPositions`: union-by-symbol across active wallets, using the primary wallet position as representative when present
- `strategyOpenOrders`: union-by-symbol across active wallets
- `strategyRecentTrades`: account-level trades, optionally deduped by `executionGroupId`

This avoids two failure modes the old plan did not account for:
- duplicate re-entries when one wallet failed and another succeeded
- missing close candidates when only non-primary wallets still hold a symbol

### Phase 3: Trading Loop Fan-Out
Update the current trading loop instead of adding a parallel multi-wallet engine.

#### Trading loop changes
- Keep one `runTradingCycle` per user.
- Fetch shared market data once.
- Resolve strategy state before hybrid candidate generation and AI prompt construction.
- Keep current hybrid selection and decision trace logging, but store:
  - `strategyWalletId`
  - `executionGroupId`
  - wallet execution results summary in `parsedResponse`

#### Wallet-aware execution
- For `OPEN_*` and `CLOSE`, iterate active execution wallets.
- For each wallet:
  - fetch wallet account state
  - fetch wallet positions/open orders as needed
  - scale `decision.size_usd` relative to that wallet’s balance before validation
  - run validator/executor with wallet context
- Keep `tradingLocks` account-level.
- Move `symbolTradeLocks` to wallet scope.
- Update in-memory duplicate tracking to include wallet identity where needed.

### Phase 4: Extract A Shared Close Pipeline
The current app has close logic in `tradeExecutor`, `manualTrigger`, and `telegram/commandHandler`. Multi-wallet should not duplicate that further.

#### Refactor target
Split current close behavior into:
- a low-level wallet close helper:
  - cancel orders
  - close on exchange
  - verify fill/remaining position
  - resolve settlement
  - persist trade row
  - remove position row
- caller-specific wrappers for:
  - AI/managed-exit closes
  - dashboard manual close
  - Telegram manual close
  - close-all flows

#### Important behavioral rule
- AI/managed-exit closes continue updating circuit breaker trade outcomes.
- Manual closes do not affect circuit breaker loss counters.

### Phase 5: Managed Exits, Position Sync, And Snapshots
These are the biggest gaps versus the old plan.

#### Managed exits
- Update `managedExitMonitor` to group positions by `walletId`, not just `userId`.
- Resolve wallet credentials per wallet.
- Replace and tighten trailing stops per wallet.
- Persist runtime stop updates back to the correct wallet position row.

#### Position sync
- Update `positionSync` and reconciliation to run per wallet.
- When a wallet position disappears on the exchange:
  - resolve historical settlement for that wallet
  - persist the close trade with `walletId`
  - remove only that wallet’s position row

#### Snapshots and analytics data
- Snapshot cycle must write one snapshot per active wallet.
- Analytics queries must accept optional `walletId`.
- Dashboard “today P&L” and analytics equity curves must read wallet-scoped snapshots.

### Phase 6: Telegram Main Wallet Routing
Telegram should route all trade views to the configured main wallet while keeping account-level risk alerts.

#### Settings
- Extend `telegramSettings` queries/mutations with:
  - `getEffectiveTelegramMainWallet`
  - `setTelegramMainWallet`
- Add a wallet selector to the existing Telegram settings UI.

#### Main-wallet reads
Route these through the wallet resolver:
- `/status`
- `/positions`
- `/balance`
- `/orders`
- `/pnl`
- `/cancel`
- periodic position updates
- daily summary

#### Notification behavior
- `notifyTradeOpened` and `notifyTradeClosed` must receive `walletId`.
- Only send those notifications when `walletId === telegramMainWalletId`.
- `notifyRiskAlert` remains account-level and is not filtered by wallet.

#### Manual close commands
- `/close SYMBOL` calls the shared cross-wallet manual close service.
- `/closeall` closes the union of open symbols across active wallets.
- Responses return per-wallet result summaries.

### Phase 7: Dashboard, Analytics, Settings, And Diagnostics
The current frontend has more single-wallet surfaces than the old plan assumed.

#### Wallet management UI
- Replace the single Hyperliquid credentials experience in Settings with a wallet manager:
  - add wallet
  - edit wallet
  - activate/deactivate wallet
  - mark primary wallet
  - mark Telegram main wallet
- Keep legacy credentials hidden behind transition fallback only.

#### Wallet selector
Add a shared wallet selector used by:
- main dashboard
- analytics page
- debug/diagnostic pages where wallet-specific data is shown

Default order:
1. URL query
2. `localStorage`
3. Telegram main wallet
4. primary wallet
5. first active wallet

#### Wallet-scoped dashboard data
Do not keep calling raw Hyperliquid client actions from the browser with one exposed address.
Replace that with wallet-aware server actions/queries such as:
- `getWalletDashboardState`
- `getWalletLivePositions`
- `getWalletOpenOrders`
- `getWalletAccountState`

#### Manual close UX
- Position row close button calls `closeSymbolAcrossWallets`.
- Close-all uses the union of symbols across active wallets.
- Toasts report `x/y wallets succeeded`.

#### Analytics and debug export
- Add optional `walletId` filters to analytics queries.
- Update `getRecentTradeDebugExport` so multi-wallet fan-out does not arbitrarily match one AI log to one trade.
- Use `executionGroupId` to group all wallet executions under the same AI/manual decision.

#### Diagnostics
- Update diagnostic/recovery/manual trigger actions and pages to:
  - inspect per-wallet DB vs exchange state
  - verify migration completeness
  - verify main-wallet routing
  - inspect wallet drift after partial failures

### Phase 8: Query, Mutation, And Action Surface Changes

#### Queries
- `getPositions(userId, walletId?)`
- `getRecentTrades(userId, limit, walletId?)`
- `getAccountSnapshots(userId, limit, walletId?, since?)`
- `getLivePositions(userId, walletId?)`
- `getWalletDashboardState(userId, walletId)`

#### Mutations
- `savePosition(..., walletId)`
- `closePosition(..., walletId)`
- `updatePositionRuntime(..., walletId)`
- `saveTrade(..., walletId, executionGroupId?)`
- `saveAccountSnapshot(..., walletId)`
- `setTelegramMainWallet(userId, walletId)`

#### Actions
- `trading.manualCloseService.closeSymbolAcrossWallets`
- `trading.manualCloseService.closeAllSymbolsAcrossWallets`
- optional wallet-aware dashboard fetch actions to replace direct client address usage

### Phase 9: Test Plan

#### Unit
- wallet resolver fallback behavior
- strategy-state union logic
- per-wallet decision size scaling
- `closeSymbolAcrossWallets` result structure
- Telegram main-wallet notification filtering

#### Integration
- migration backfills all wallet IDs
- hybrid candidate generation blocks duplicate opens when any wallet already holds the symbol
- managed exit monitor updates stops for the correct wallet row
- position sync reconciles only the affected wallet
- dashboard and analytics filter by selected wallet
- Telegram reads only use main wallet
- manual close and close-all return partial-success summaries

#### Regression-focused
- AI logs and trade debug export still make sense after one decision creates multiple trade rows
- manual close does not increment circuit breaker loss streaks
- managed exits still work for trailing, tighten, stale-trade, and max-hold paths

## Rollout Strategy
1. Ship schema changes plus migration and diagnostics first.
2. Ship dual-read wallet resolution with legacy fallback.
3. Convert write paths to require `walletId`.
4. Move close logic to the shared close service.
5. Update managed exits, sync, and snapshots.
6. Update Telegram routing.
7. Update dashboard, analytics, settings, and diagnostics.
8. Remove legacy credential fallback once backfill is verified.

## Notes On Scope
- Backtesting can remain account-level for this phase.
- Risk alerts remain account-level.
- This phase does not require an “all-wallet merged dashboard”; one selected wallet view is enough.
- The biggest architectural risk is not the schema migration. It is preserving hybrid-selection semantics, managed-exit behavior, and debug/analytics integrity once one decision fans out to multiple wallet executions.
