import { cronJobs } from "convex/server";
import { internal } from "./fnRefs";

const crons = cronJobs();

// Main trading loop - runs every 5 minutes (reduced from 3 to decrease overtrading)
crons.interval(
  "trading-loop",
  { minutes: 5 },
  internal.trading.tradingLoop.runTradingCycle
);

// Position sync - runs every 1 minute to catch positions closed on exchange
crons.interval(
  "position-sync",
  { minutes: 1 },
  internal.trading.positionSync.syncAllPositions
);

// Cleanup expired locks - runs every 5 minutes
crons.interval(
  "cleanup-locks",
  { minutes: 5 },
  internal.mutations.cleanupExpiredLocks
);

// Research/sentiment cycle - runs every 12 hours
crons.interval(
  "research-cycle",
  { hours: 12 },
  internal.research.researchLoop.runResearchCycle
);

// Telegram daily summary - runs every 24 hours
crons.interval(
  "telegram-daily-summary",
  { hours: 24 },
  internal.telegram.dailySummary.sendDailySummaries
);

// Account snapshots - captures equity curve data every 15 minutes
crons.interval(
  "account-snapshot",
  { minutes: 15 },
  internal.snapshots.snapshotCycle.takeAccountSnapshots
);

export default crons;
