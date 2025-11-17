import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Main trading loop - runs every 3 minutes
crons.interval(
  "trading-loop",
  { minutes: 3 },
  internal.trading.tradingLoop.runTradingCycle
);

// Position sync - runs every 1 minute to catch positions closed on exchange
crons.interval(
  "position-sync",
  { minutes: 1 },
  internal.trading.positionSync.syncAllPositions
);

export default crons;
