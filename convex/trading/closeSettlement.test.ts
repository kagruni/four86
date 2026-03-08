import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveCloseSettlement,
  resolveHistoricalCloseSettlement,
} from "./closeSettlement";

function assertApproxEqual(actual: number, expected: number, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function createTestCtx(fills: any[]) {
  const mutationCalls: any[] = [];

  return {
    mutationCalls,
    ctx: {
      async runAction(_ref: unknown, _args: unknown) {
        return fills;
      },
      async runMutation(_ref: unknown, args: unknown) {
        mutationCalls.push(args);
        return null;
      },
    },
  };
}

const fakeApi = {
  hyperliquid: {
    client: {
      getUserFillsByTime: "getUserFillsByTime",
    },
  },
  mutations: {
    saveSystemLog: "saveSystemLog",
  },
};

test("resolveCloseSettlement falls back to close-fill window when order id does not match", async () => {
  const submittedAt = 1_000_000;
  const { ctx, mutationCalls } = createTestCtx([
    {
      coin: "SOL",
      oid: 111,
      dir: "Close Short",
      startPosition: "-3.7",
      time: submittedAt + 1_500,
      px: "82.43513513513513",
      sz: "3.7",
      closedPnl: "2.09",
      fee: "0.13",
      feeToken: "USDC",
    },
  ]);

  const settlement = await resolveCloseSettlement(ctx, fakeApi, {
    userId: "user_1",
    address: "0xabc",
    testnet: false,
    symbol: "SOL",
    side: "SHORT",
    entryPrice: 83,
    position: {
      currentPrice: 82.43513513513513,
      entryPrice: 83,
      size: 307.1,
    },
    closeResult: {
      orderId: 999,
      avgPx: 82.43513513513513,
      totalSz: 3.7,
      txHash: "0xtx",
    },
    submittedAt,
  });

  assert.equal(settlement.pnlSource, "exchange_fill_window");
  assertApproxEqual(settlement.pnl, 1.96);
  assertApproxEqual(settlement.grossPnl, 2.09);
  assert.equal(settlement.fee, 0.13);
  assert.equal(settlement.sizeInCoins, 3.7);
  assertApproxEqual(settlement.exitPrice, 82.43513513513513);
  assert.equal(mutationCalls.length, 0);
});

test("resolveHistoricalCloseSettlement prefers exchange closed pnl over stale DB unrealized pnl", async () => {
  const observedAt = 2_000_000;
  const { ctx, mutationCalls } = createTestCtx([
    {
      coin: "SOL",
      oid: 222,
      dir: "Close Short",
      startPosition: "-3.7",
      time: observedAt - 2_000,
      px: "82.43513513513513",
      sz: "3.7",
      closedPnl: "2.09",
      fee: "0.13",
      feeToken: "USDC",
    },
  ]);

  const settlement = await resolveHistoricalCloseSettlement(ctx, fakeApi, {
    userId: "user_1",
    address: "0xabc",
    testnet: false,
    observedAt,
    position: {
      symbol: "SOL",
      side: "SHORT",
      entryPrice: 83,
      currentPrice: 82.43513513513513,
      size: 307.1,
      unrealizedPnl: 1.05,
      unrealizedPnlPct: 0.35,
      openedAt: observedAt - 60_000,
    },
  });

  assert.equal(settlement.pnlSource, "exchange_fill_reconciled");
  assertApproxEqual(settlement.pnl, 1.96);
  assertApproxEqual(settlement.grossPnl, 2.09);
  assert.equal(settlement.fee, 0.13);
  assertApproxEqual(settlement.tradeValueUsd, 82.43513513513513 * 3.7);
  assertApproxEqual(settlement.exitPrice, 82.43513513513513);
  assert.equal(mutationCalls.length, 0);
});

test("resolveCloseSettlement preserves net pnl when fill payload is already fee-adjusted", async () => {
  const submittedAt = 3_000_000;
  const { ctx } = createTestCtx([
    {
      coin: "SOL",
      oid: 333,
      dir: "Close Short",
      startPosition: "-3.7",
      time: submittedAt + 500,
      px: "82.43513513513513",
      sz: "3.7",
      closedPnl: "1.96",
      fee: "0.13",
      feeToken: "USDC",
    },
  ]);

  const settlement = await resolveCloseSettlement(ctx, fakeApi, {
    userId: "user_1",
    address: "0xabc",
    testnet: false,
    symbol: "SOL",
    side: "SHORT",
    entryPrice: 83,
    position: {
      currentPrice: 82.43513513513513,
      entryPrice: 83,
      size: 307.1,
    },
    closeResult: {
      orderId: 333,
      avgPx: 82.43513513513513,
      totalSz: 3.7,
      txHash: "0xtx",
    },
    submittedAt,
  });

  assert.equal(settlement.pnlSource, "exchange_fill");
  assertApproxEqual(settlement.pnl, 1.96);
  assertApproxEqual(settlement.grossPnl, 2.09);
  assert.equal(settlement.fee, 0.13);
});
