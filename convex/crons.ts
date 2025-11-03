import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Main trading loop - runs every 3 minutes
crons.interval(
  "trading-loop",
  { minutes: 3 },
  internal.trading.tradingLoop.runTradingCycle
);

// Position monitoring - runs every 1 minute
// crons.interval(
//   "position-monitor",
//   { minutes: 1 },
//   internal.trading.positionMonitor.checkPositions
// );

// Account sync - runs every 5 minutes
// crons.interval(
//   "account-sync",
//   { minutes: 5 },
//   internal.trading.accountSync.syncAllAccounts
// );

export default crons;
