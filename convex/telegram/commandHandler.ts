import { httpAction } from "../_generated/server";
import { api, internal } from "../fnRefs";
import {
  formatPositions,
  formatStatus,
  formatPnl,
  formatBalance,
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
  text: string
): Promise<void> {
  await ctx.runAction(internal.telegram.telegramApi.sendMessage, {
    chatId,
    text,
  });
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
  const token = generateToken();

  await ctx.runMutation(
    internal.telegram.telegramMutations.storePendingConfirmation,
    {
      userId,
      action: "closeall",
      token,
      expiresAt: Date.now() + 60000,
    }
  );

  await reply(
    ctx,
    chatId,
    `Are you sure you want to close *all* positions?\nSend \`/confirm ${token}\` within 60 seconds to proceed.`
  );
}

async function handleClose(
  ctx: any,
  chatId: string,
  userId: string,
  text: string
): Promise<void> {
  const parts = text.split(/\s+/);
  const symbol = parts[1]?.toUpperCase();

  if (!symbol) {
    await reply(ctx, chatId, "Usage: `/close <SYMBOL>`\nExample: `/close BTC`");
    return;
  }

  const token = generateToken();

  await ctx.runMutation(
    internal.telegram.telegramMutations.storePendingConfirmation,
    {
      userId,
      action: `close_${symbol}`,
      token,
      expiresAt: Date.now() + 60000,
    }
  );

  await reply(
    ctx,
    chatId,
    `Close *${symbol}* position?\nSend \`/confirm ${token}\` within 60 seconds to proceed.`
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
  } else {
    await reply(ctx, chatId, "Unknown pending action.");
  }
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
    "`/close <SYMBOL>` - Close a specific position",
    "`/closeall` - Close all positions",
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
        case "/closeall":
          await handleCloseAll(ctx, chatId, userId);
          break;
        case "/close":
          await handleClose(ctx, chatId, userId, text);
          break;
        case "/confirm":
          await handleConfirm(ctx, chatId, userId, text);
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
