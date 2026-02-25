import { httpAction } from "../_generated/server";
import { api, internal } from "../fnRefs";
import {
  formatPositions,
  formatStatus,
  formatPnl,
  formatBalance,
  formatOrders,
  formatUsd,
} from "./messageTemplates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < 6; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function reply(
  ctx: any,
  chatId: string,
  text: string,
  replyMarkup?: string
): Promise<void> {
  await ctx.runAction(internal.telegram.telegramApi.sendMessage, {
    chatId,
    text,
    ...(replyMarkup ? { replyMarkup } : {}),
  });
}

function inlineKeyboard(rows: { text: string; callback_data: string }[][]): string {
  return JSON.stringify({ inline_keyboard: rows });
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleLink(
  ctx: any,
  chatId: string,
  text: string
): Promise<void> {
  const parts = text.split(/\s+/);
  const code = parts[1];

  if (!code) {
    await reply(ctx, chatId, "Usage: `/link <code>`\nGet your code from the dashboard.");
    return;
  }

  const result = await ctx.runMutation(
    internal.telegram.telegramMutations.verifyLink,
    { chatId, verificationCode: code.toUpperCase() }
  );

  if (result.success) {
    await reply(ctx, chatId, "Account linked successfully! You can now use all commands.");
  } else {
    await reply(ctx, chatId, `Link failed: ${result.error}`);
  }
}

async function handlePositions(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  const positions = await ctx.runAction(api.liveQueries.getLivePositions, {
    userId,
  });

  const formatted = formatPositions(
    (positions || []).map((p: any) => ({
      symbol: p.symbol,
      side: p.side,
      size: p.size,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      unrealizedPnl: p.unrealizedPnl ?? 0,
      unrealizedPnlPct: p.unrealizedPnlPct ?? 0,
      leverage: p.leverage ?? 1,
    }))
  );

  await reply(ctx, chatId, formatted);
}

async function handleStatus(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  const botConfig = await ctx.runQuery(api.queries.getBotConfig, { userId });

  if (!botConfig) {
    await reply(ctx, chatId, "No bot configuration found.");
    return;
  }

  const credentials = await ctx.runQuery(
    internal.queries.getFullUserCredentials,
    { userId }
  );

  if (!credentials?.hyperliquidAddress) {
    await reply(ctx, chatId, "No Hyperliquid credentials configured.");
    return;
  }

  const testnet = credentials.hyperliquidTestnet ?? true;

  const accountState = await ctx.runAction(
    api.hyperliquid.client.getAccountState,
    { address: credentials.hyperliquidAddress, testnet }
  );

  const formatted = formatStatus(
    {
      isActive: botConfig.isActive,
      modelName: botConfig.modelName ?? "Unknown",
      symbols: botConfig.symbols ?? [],
      circuitBreakerState: botConfig.circuitBreakerState,
    },
    {
      accountValue: accountState.accountValue,
      marginUsed: accountState.totalMarginUsed,
      withdrawable: accountState.withdrawable,
    }
  );

  await reply(ctx, chatId, formatted);
}

async function handlePnl(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  const trades = await ctx.runQuery(api.queries.getRecentTrades, {
    userId,
    limit: 50,
  });

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentTrades = (trades || []).filter(
    (t: any) => (t.executedAt || t.createdAt || 0) >= oneDayAgo
  );

  const formatted = formatPnl(
    recentTrades.map((t: any) => ({
      symbol: t.symbol,
      pnl: t.pnl,
      pnlPct: t.pnlPct,
      side: t.side,
      executedAt: t.executedAt || t.createdAt || Date.now(),
    }))
  );

  await reply(ctx, chatId, formatted);
}

async function handleBalance(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  const credentials = await ctx.runQuery(
    internal.queries.getFullUserCredentials,
    { userId }
  );

  if (!credentials?.hyperliquidAddress) {
    await reply(ctx, chatId, "No Hyperliquid credentials configured.");
    return;
  }

  const testnet = credentials.hyperliquidTestnet ?? true;

  const accountState = await ctx.runAction(
    api.hyperliquid.client.getAccountState,
    { address: credentials.hyperliquidAddress, testnet }
  );

  const formatted = formatBalance({
    accountValue: accountState.accountValue,
    marginUsed: accountState.totalMarginUsed,
    withdrawable: accountState.withdrawable,
  });

  await reply(ctx, chatId, formatted);
}

async function handleOrders(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  const credentials = await ctx.runQuery(
    internal.queries.getFullUserCredentials,
    { userId }
  );

  if (!credentials?.hyperliquidAddress) {
    await reply(ctx, chatId, "No Hyperliquid credentials configured.");
    return;
  }

  const testnet = credentials.hyperliquidTestnet ?? true;

  const orders = await ctx.runAction(
    api.hyperliquid.client.getFrontendOpenOrders,
    { address: credentials.hyperliquidAddress, testnet }
  );

  const formatted = formatOrders(
    (orders || []).map((o: any, i: number) => ({
      index: i + 1,
      symbol: o.coin,
      side: o.side,
      size: o.sz,
      price: o.limitPx || o.px || "0",
      orderType: o.orderType || "Limit",
      isTrigger: o.isTrigger ?? false,
      triggerPrice: o.triggerPx,
      oid: o.oid,
    }))
  );

  await reply(ctx, chatId, formatted);
}

async function handleCancel(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  const credentials = await ctx.runQuery(
    internal.queries.getFullUserCredentials,
    { userId }
  );

  if (!credentials?.hyperliquidAddress) {
    await reply(ctx, chatId, "No Hyperliquid credentials configured.");
    return;
  }

  const testnet = credentials.hyperliquidTestnet ?? true;

  const orders = await ctx.runAction(
    api.hyperliquid.client.getFrontendOpenOrders,
    { address: credentials.hyperliquidAddress, testnet }
  );

  if (!orders || orders.length === 0) {
    await reply(ctx, chatId, "No open orders to cancel.");
    return;
  }

  // Build a button per order
  const buttons = orders.map((o: any) => {
    const sideLabel = o.side === "B" ? "BUY" : "SELL";
    const typeLabel = o.isTrigger ? (o.orderType || "Trigger") : "Limit";
    const price = o.limitPx || o.px || "?";
    return [{
      text: `${o.coin} ${sideLabel} ${typeLabel} $${price}`,
      callback_data: `cxl_${o.oid}_${o.coin}`,
    }];
  });

  await reply(
    ctx,
    chatId,
    `\u{1F4CB} *Cancel Order*\n\nSelect an order to cancel:`,
    inlineKeyboard(buttons)
  );
}

async function handleStop(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  await ctx.runMutation(api.mutations.toggleBot, {
    userId,
    isActive: false,
  });
  await reply(ctx, chatId, "Bot stopped.");
}

async function handleStart(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  await ctx.runMutation(api.mutations.toggleBot, {
    userId,
    isActive: true,
  });
  await reply(ctx, chatId, "Bot started.");
}

async function handleCloseAll(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  const positions = await ctx.runAction(api.liveQueries.getLivePositions, {
    userId,
  });

  if (!positions || positions.length === 0) {
    await reply(ctx, chatId, "No open positions to close.");
    return;
  }

  const positionList = positions
    .map((p: any) => {
      const dir = p.side?.toUpperCase() === "LONG" ? "\u{2197}\u{FE0F}" : "\u{2198}\u{FE0F}";
      return `${dir} *${p.symbol}* ${p.side?.toUpperCase()}`;
    })
    .join("\n");

  await reply(
    ctx,
    chatId,
    `\u{26A0}\u{FE0F} *Close ALL positions?*\n\n${positionList}\n\nThis cannot be undone.`,
    inlineKeyboard([
      [
        { text: "\u{2705} Yes, close all", callback_data: "claY" },
        { text: "\u{274C} Cancel", callback_data: "claN" },
      ],
    ])
  );
}

async function handleClose(
  ctx: any,
  chatId: string,
  userId: string,
  text: string
): Promise<void> {
  const positions = await ctx.runAction(api.liveQueries.getLivePositions, {
    userId,
  });

  if (!positions || positions.length === 0) {
    await reply(ctx, chatId, "No open positions to close.");
    return;
  }

  const parts = text.split(/\s+/);
  const symbol = parts[1]?.toUpperCase();

  if (symbol) {
    // Direct symbol given — show confirmation buttons
    const pos = positions.find((p: any) => p.symbol === symbol);
    if (!pos) {
      await reply(ctx, chatId, `No open position for *${symbol}*.`);
      return;
    }

    const dir = pos.side?.toUpperCase() === "LONG" ? "\u{2197}\u{FE0F}" : "\u{2198}\u{FE0F}";
    const pnl = formatUsd(pos.unrealizedPnl ?? 0);

    await reply(
      ctx,
      chatId,
      `${dir} Close *${symbol}* ${pos.side?.toUpperCase()} position?\n\nCurrent P&L: \`${pnl}\``,
      inlineKeyboard([
        [
          { text: `\u{2705} Yes, close ${symbol}`, callback_data: `clsY_${symbol}` },
          { text: "\u{274C} Cancel", callback_data: "clsN" },
        ],
      ])
    );
    return;
  }

  // No symbol given — show buttons for each open position
  const buttons = positions.map((p: any) => {
    const dir = p.side?.toUpperCase() === "LONG" ? "\u{2197}\u{FE0F}" : "\u{2198}\u{FE0F}";
    const pnl = formatUsd(p.unrealizedPnl ?? 0);
    return [{
      text: `${dir} ${p.symbol} ${p.side?.toUpperCase()} (${pnl})`,
      callback_data: `cls_${p.symbol}`,
    }];
  });

  await reply(
    ctx,
    chatId,
    `\u{1F4CA} *Close Position*\n\nSelect a position to close:`,
    inlineKeyboard(buttons)
  );
}

async function handleConfirm(
  ctx: any,
  chatId: string,
  userId: string,
  text: string
): Promise<void> {
  const parts = text.split(/\s+/);
  const token = parts[1]?.toUpperCase();

  if (!token) {
    await reply(ctx, chatId, "Usage: `/confirm <token>`");
    return;
  }

  // Look up the pending action
  const settings = await ctx.runQuery(
    internal.telegram.telegramQueries.getSettingsByChatId,
    { chatId }
  );

  if (
    !settings ||
    !settings.pendingAction ||
    !settings.pendingActionToken ||
    !settings.pendingActionExpiresAt
  ) {
    await reply(ctx, chatId, "No pending action found.");
    return;
  }

  if (settings.pendingActionToken !== token) {
    await reply(ctx, chatId, "Invalid confirmation token.");
    return;
  }

  if (Date.now() > settings.pendingActionExpiresAt) {
    await ctx.runMutation(
      internal.telegram.telegramMutations.clearPendingConfirmation,
      { userId }
    );
    await reply(ctx, chatId, "Confirmation expired. Please try again.");
    return;
  }

  const action = settings.pendingAction;

  // Clear the pending action first
  await ctx.runMutation(
    internal.telegram.telegramMutations.clearPendingConfirmation,
    { userId }
  );

  const credentials = await ctx.runQuery(
    internal.queries.getFullUserCredentials,
    { userId }
  );

  if (!credentials?.hyperliquidPrivateKey || !credentials?.hyperliquidAddress) {
    await reply(ctx, chatId, "No Hyperliquid credentials configured.");
    return;
  }

  const testnet = credentials.hyperliquidTestnet ?? true;

  if (action === "closeall") {
    // Close all positions
    const positions = await ctx.runAction(api.liveQueries.getLivePositions, {
      userId,
    });

    if (!positions || positions.length === 0) {
      await reply(ctx, chatId, "No open positions to close.");
      return;
    }

    const results: string[] = [];

    for (const pos of positions) {
      try {
        await ctx.runAction(api.hyperliquid.client.closePosition, {
          privateKey: credentials.hyperliquidPrivateKey,
          address: credentials.hyperliquidAddress,
          symbol: pos.symbol,
          size: pos.size / pos.entryPrice, // Convert USD to coin size
          isBuy: pos.side === "SHORT", // Opposite side to close
          testnet,
        });

        // Remove from database
        await ctx.runMutation(api.mutations.closePosition, {
          userId,
          symbol: pos.symbol,
        });

        results.push(`${pos.symbol}: closed`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push(`${pos.symbol}: failed - ${msg}`);
      }
    }

    await reply(ctx, chatId, `*Close All Results:*\n\n${results.join("\n")}`);
  } else if (action.startsWith("close_")) {
    // Close a specific symbol
    const symbol = action.replace("close_", "");

    const positions = await ctx.runAction(api.liveQueries.getLivePositions, {
      userId,
    });

    const position = (positions || []).find(
      (p: any) => p.symbol === symbol
    );

    if (!position) {
      await reply(ctx, chatId, `No open position for *${symbol}*.`);
      return;
    }

    await ctx.runAction(api.hyperliquid.client.closePosition, {
      privateKey: credentials.hyperliquidPrivateKey,
      address: credentials.hyperliquidAddress,
      symbol: position.symbol,
      size: position.size / position.entryPrice,
      isBuy: position.side === "SHORT",
      testnet,
    });

    // Remove from database
    await ctx.runMutation(api.mutations.closePosition, {
      userId,
      symbol,
    });

    await reply(ctx, chatId, `*${symbol}* position closed.`);
  } else if (action.startsWith("cancelorder_")) {
    // action format: "cancelorder_BTC_12345"
    const actionParts = action.split("_");
    const symbol = actionParts[1];
    const oid = parseInt(actionParts[2], 10);

    await ctx.runAction(api.hyperliquid.client.cancelOrder, {
      privateKey: credentials.hyperliquidPrivateKey,
      address: credentials.hyperliquidAddress,
      symbol,
      orderId: oid,
      testnet,
    });

    await reply(ctx, chatId, `Order \`${oid}\` for *${symbol}* cancelled.`);
  } else {
    await reply(ctx, chatId, "Unknown pending action.");
  }
}

const VALID_INTERVALS = [5, 10, 20, 30, 45, 60];

async function handleNotifications(
  ctx: any,
  chatId: string,
  userId: string
): Promise<void> {
  const settings = await ctx.runQuery(
    internal.telegram.telegramQueries.getSettingsByChatId,
    { chatId }
  );

  const current = settings?.positionUpdateInterval ?? 0;
  const label = current > 0 ? `every ${current} minutes` : "off";

  // Build inline keyboard with interval options
  const buttons = [
    [
      { text: current === 5 ? "\u{2705} 5 min" : "5 min", callback_data: "notif_5" },
      { text: current === 10 ? "\u{2705} 10 min" : "10 min", callback_data: "notif_10" },
      { text: current === 20 ? "\u{2705} 20 min" : "20 min", callback_data: "notif_20" },
    ],
    [
      { text: current === 30 ? "\u{2705} 30 min" : "30 min", callback_data: "notif_30" },
      { text: current === 45 ? "\u{2705} 45 min" : "45 min", callback_data: "notif_45" },
      { text: current === 60 ? "\u{2705} 60 min" : "60 min", callback_data: "notif_60" },
    ],
    [
      { text: current === 0 ? "\u{2705} Off" : "\u{274C} Off", callback_data: "notif_0" },
    ],
  ];

  const replyMarkup = JSON.stringify({
    inline_keyboard: buttons,
  });

  await ctx.runAction(internal.telegram.telegramApi.sendMessage, {
    chatId,
    text: `\u{1F514} *Position Update Notifications*\n\nCurrent: \`${label}\`\n\nSelect how often you want position updates:`,
    replyMarkup,
  });
}

/**
 * Handle inline keyboard button presses for notification interval selection.
 */
async function handleNotificationCallback(
  ctx: any,
  callbackQueryId: string,
  chatId: string,
  userId: string,
  data: string
): Promise<void> {
  const intervalStr = data.replace("notif_", "");
  const interval = parseInt(intervalStr, 10);

  if (isNaN(interval) || (interval !== 0 && !VALID_INTERVALS.includes(interval))) {
    await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
      callbackQueryId,
      text: "Invalid option.",
    });
    return;
  }

  await ctx.runMutation(
    internal.telegram.telegramMutations.updatePositionInterval,
    { userId, interval }
  );

  const label = interval === 0 ? "disabled" : `every ${interval} minutes`;

  // Acknowledge the button press with a toast notification
  await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
    callbackQueryId,
    text: `Position updates ${label}`,
  });

  // Send a confirmation message
  await reply(
    ctx,
    chatId,
    interval === 0
      ? "\u{1F515} Position updates *disabled*."
      : `\u{1F514} Position updates set to *${label}*.\nYou'll receive updates when you have open positions.`
  );
}

// ---------------------------------------------------------------------------
// Close position callback handlers
// ---------------------------------------------------------------------------

/** User tapped a position from the list — show confirmation */
async function handleCloseSelectCallback(
  ctx: any,
  callbackQueryId: string,
  chatId: string,
  userId: string,
  data: string
): Promise<void> {
  const symbol = data.replace("cls_", "");

  const positions = await ctx.runAction(api.liveQueries.getLivePositions, {
    userId,
  });

  const pos = (positions || []).find((p: any) => p.symbol === symbol);

  if (!pos) {
    await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
      callbackQueryId,
      text: `No position found for ${symbol}`,
    });
    return;
  }

  await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
    callbackQueryId,
  });

  const dir = pos.side?.toUpperCase() === "LONG" ? "\u{2197}\u{FE0F}" : "\u{2198}\u{FE0F}";
  const pnl = formatUsd(pos.unrealizedPnl ?? 0);

  await reply(
    ctx,
    chatId,
    `${dir} Close *${symbol}* ${pos.side?.toUpperCase()} position?\n\nCurrent P&L: \`${pnl}\``,
    inlineKeyboard([
      [
        { text: `\u{2705} Yes, close ${symbol}`, callback_data: `clsY_${symbol}` },
        { text: "\u{274C} Cancel", callback_data: "clsN" },
      ],
    ])
  );
}

/** User confirmed closing a position */
async function handleCloseConfirmCallback(
  ctx: any,
  callbackQueryId: string,
  chatId: string,
  userId: string,
  data: string
): Promise<void> {
  const symbol = data.replace("clsY_", "");

  await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
    callbackQueryId,
    text: `Closing ${symbol}...`,
  });

  const credentials = await ctx.runQuery(
    internal.queries.getFullUserCredentials,
    { userId }
  );

  if (!credentials?.hyperliquidPrivateKey || !credentials?.hyperliquidAddress) {
    await reply(ctx, chatId, "No Hyperliquid credentials configured.");
    return;
  }

  const testnet = credentials.hyperliquidTestnet ?? true;

  const positions = await ctx.runAction(api.liveQueries.getLivePositions, {
    userId,
  });

  const position = (positions || []).find((p: any) => p.symbol === symbol);

  if (!position) {
    await reply(ctx, chatId, `No open position for *${symbol}*.`);
    return;
  }

  await ctx.runAction(api.hyperliquid.client.closePosition, {
    privateKey: credentials.hyperliquidPrivateKey,
    address: credentials.hyperliquidAddress,
    symbol: position.symbol,
    size: position.size / position.entryPrice,
    isBuy: position.side === "SHORT",
    testnet,
  });

  await ctx.runMutation(api.mutations.closePosition, {
    userId,
    symbol,
  });

  await reply(ctx, chatId, `\u{2705} *${symbol}* position closed.`);
}

// ---------------------------------------------------------------------------
// Close all callback handlers
// ---------------------------------------------------------------------------

async function handleCloseAllConfirmCallback(
  ctx: any,
  callbackQueryId: string,
  chatId: string,
  userId: string
): Promise<void> {
  await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
    callbackQueryId,
    text: "Closing all positions...",
  });

  const credentials = await ctx.runQuery(
    internal.queries.getFullUserCredentials,
    { userId }
  );

  if (!credentials?.hyperliquidPrivateKey || !credentials?.hyperliquidAddress) {
    await reply(ctx, chatId, "No Hyperliquid credentials configured.");
    return;
  }

  const testnet = credentials.hyperliquidTestnet ?? true;

  const positions = await ctx.runAction(api.liveQueries.getLivePositions, {
    userId,
  });

  if (!positions || positions.length === 0) {
    await reply(ctx, chatId, "No open positions to close.");
    return;
  }

  const results: string[] = [];

  for (const pos of positions) {
    try {
      await ctx.runAction(api.hyperliquid.client.closePosition, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: pos.symbol,
        size: pos.size / pos.entryPrice,
        isBuy: pos.side === "SHORT",
        testnet,
      });

      await ctx.runMutation(api.mutations.closePosition, {
        userId,
        symbol: pos.symbol,
      });

      results.push(`\u{2705} ${pos.symbol}: closed`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push(`\u{274C} ${pos.symbol}: ${msg}`);
    }
  }

  await reply(ctx, chatId, `*Close All Results:*\n\n${results.join("\n")}`);
}

// ---------------------------------------------------------------------------
// Cancel order callback handlers
// ---------------------------------------------------------------------------

/** User tapped an order — show confirmation */
async function handleCancelSelectCallback(
  ctx: any,
  callbackQueryId: string,
  chatId: string,
  data: string
): Promise<void> {
  // data = "cxl_<oid>_<coin>"
  const parts = data.split("_");
  const oid = parts[1];
  const coin = parts[2];

  await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
    callbackQueryId,
  });

  await reply(
    ctx,
    chatId,
    `Cancel *${coin}* order \`${oid}\`?`,
    inlineKeyboard([
      [
        { text: `\u{2705} Yes, cancel`, callback_data: `cxlY_${oid}_${coin}` },
        { text: "\u{274C} No", callback_data: "cxlN" },
      ],
    ])
  );
}

/** User confirmed cancelling an order */
async function handleCancelConfirmCallback(
  ctx: any,
  callbackQueryId: string,
  chatId: string,
  userId: string,
  data: string
): Promise<void> {
  // data = "cxlY_<oid>_<coin>"
  const parts = data.split("_");
  const oid = parseInt(parts[1], 10);
  const coin = parts[2];

  await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
    callbackQueryId,
    text: `Cancelling ${coin} order...`,
  });

  const credentials = await ctx.runQuery(
    internal.queries.getFullUserCredentials,
    { userId }
  );

  if (!credentials?.hyperliquidPrivateKey || !credentials?.hyperliquidAddress) {
    await reply(ctx, chatId, "No Hyperliquid credentials configured.");
    return;
  }

  const testnet = credentials.hyperliquidTestnet ?? true;

  await ctx.runAction(api.hyperliquid.client.cancelOrder, {
    privateKey: credentials.hyperliquidPrivateKey,
    address: credentials.hyperliquidAddress,
    symbol: coin,
    orderId: oid,
    testnet,
  });

  await reply(ctx, chatId, `\u{2705} Order \`${oid}\` for *${coin}* cancelled.`);
}

function getHelpText(): string {
  return [
    "*Available Commands:*",
    "",
    "`/link <code>` - Link your Telegram account",
    "`/status` - Bot status and account info",
    "`/positions` - Open positions with live P&L",
    "`/balance` - Account balance",
    "`/pnl` - Today's P&L summary",
    "`/start` - Start the trading bot",
    "`/stop` - Stop the trading bot",
    "`/orders` - View all open orders (limit + TP/SL)",
    "`/cancel` - Cancel an order",
    "`/close` - Close a position",
    "`/closeall` - Close all positions",
    "`/notifications` - Position update interval",
    "`/help` - Show this message",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main webhook handler
// ---------------------------------------------------------------------------

export const handleTelegramWebhook = httpAction(async (ctx, request) => {
  try {
    // Validate webhook secret
    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (expectedSecret && secretHeader !== expectedSecret) {
      return new Response(null, { status: 401 });
    }

    const update = await request.json();

    // -----------------------------------------------------------------------
    // Handle callback queries (inline keyboard button presses)
    // -----------------------------------------------------------------------
    if (update.callback_query) {
      const cbQuery = update.callback_query;
      const cbChatId = String(cbQuery.message?.chat?.id ?? "");
      const cbData = cbQuery.data ?? "";
      const cbQueryId = cbQuery.id;

      if (!cbChatId) return new Response(null, { status: 200 });

      const settings = await ctx.runQuery(
        internal.telegram.telegramQueries.getSettingsByChatId,
        { chatId: cbChatId }
      );

      if (!settings?.isLinked) {
        await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
          callbackQueryId: cbQueryId,
          text: "Account not linked.",
        });
        return new Response(null, { status: 200 });
      }

      const cbUserId = settings.userId;

      try {
        // Notification interval buttons
        if (cbData.startsWith("notif_")) {
          await handleNotificationCallback(ctx, cbQueryId, cbChatId, cbUserId, cbData);
        }
        // Close position — select from list
        else if (cbData.startsWith("cls_")) {
          await handleCloseSelectCallback(ctx, cbQueryId, cbChatId, cbUserId, cbData);
        }
        // Close position — confirmed
        else if (cbData.startsWith("clsY_")) {
          await handleCloseConfirmCallback(ctx, cbQueryId, cbChatId, cbUserId, cbData);
        }
        // Close position — cancelled
        else if (cbData === "clsN") {
          await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
            callbackQueryId: cbQueryId,
            text: "Cancelled.",
          });
        }
        // Close all — confirmed
        else if (cbData === "claY") {
          await handleCloseAllConfirmCallback(ctx, cbQueryId, cbChatId, cbUserId);
        }
        // Close all — cancelled
        else if (cbData === "claN") {
          await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
            callbackQueryId: cbQueryId,
            text: "Cancelled.",
          });
        }
        // Cancel order — select from list
        else if (cbData.startsWith("cxl_")) {
          await handleCancelSelectCallback(ctx, cbQueryId, cbChatId, cbData);
        }
        // Cancel order — confirmed
        else if (cbData.startsWith("cxlY_")) {
          await handleCancelConfirmCallback(ctx, cbQueryId, cbChatId, cbUserId, cbData);
        }
        // Cancel order — cancelled
        else if (cbData === "cxlN") {
          await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
            callbackQueryId: cbQueryId,
            text: "Cancelled.",
          });
        }
        else {
          await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
            callbackQueryId: cbQueryId,
            text: "Unknown action.",
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await ctx.runAction(internal.telegram.telegramApi.answerCallbackQuery, {
          callbackQueryId: cbQueryId,
          text: `Error: ${msg}`,
        });
      }

      return new Response(null, { status: 200 });
    }

    // -----------------------------------------------------------------------
    // Handle regular messages / commands
    // -----------------------------------------------------------------------
    const chatId = String(update.message?.chat?.id ?? "");
    const text = (update.message?.text ?? "").trim();

    // Non-text updates (stickers, photos, etc.) - just acknowledge
    if (!text || !chatId) {
      return new Response(null, { status: 200 });
    }

    const command = text.split(/\s+/)[0].toLowerCase();

    // /link does not require a linked account
    if (command === "/link") {
      try {
        await handleLink(ctx, chatId, text);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await reply(ctx, chatId, `Error: ${msg}`);
      }
      return new Response(null, { status: 200 });
    }

    // All other commands require a linked account
    const settings = await ctx.runQuery(
      internal.telegram.telegramQueries.getSettingsByChatId,
      { chatId }
    );

    if (!settings || !settings.isLinked) {
      await reply(
        ctx,
        chatId,
        "Not linked. Use `/link <code>` from the dashboard."
      );
      return new Response(null, { status: 200 });
    }

    const userId = settings.userId;

    try {
      switch (command) {
        case "/positions":
          await handlePositions(ctx, chatId, userId);
          break;
        case "/status":
          await handleStatus(ctx, chatId, userId);
          break;
        case "/pnl":
          await handlePnl(ctx, chatId, userId);
          break;
        case "/balance":
          await handleBalance(ctx, chatId, userId);
          break;
        case "/stop":
          await handleStop(ctx, chatId, userId);
          break;
        case "/start":
          await handleStart(ctx, chatId, userId);
          break;
        case "/orders":
          await handleOrders(ctx, chatId, userId);
          break;
        case "/cancel":
          await handleCancel(ctx, chatId, userId);
          break;
        case "/closeall":
          await handleCloseAll(ctx, chatId, userId);
          break;
        case "/close":
          await handleClose(ctx, chatId, userId, text);
          break;
        case "/confirm":
          await handleConfirm(ctx, chatId, userId, text);
          break;
        case "/notifications":
          await handleNotifications(ctx, chatId, userId);
          break;
        case "/help":
          await reply(ctx, chatId, getHelpText());
          // Register command menu (idempotent, ensures / menu is set up)
          try { ctx.runAction(internal.telegram.telegramApi.setMyCommands, {}); } catch {}
          break;
        default:
          await reply(ctx, chatId, "Unknown command. Send /help for available commands.");
          break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await reply(ctx, chatId, `Error: ${msg}`);
    }
  } catch (err: unknown) {
    // Top-level catch: parsing errors, etc.
    console.error("[Telegram webhook] Unhandled error:", err);
  }

  return new Response(null, { status: 200 });
});
