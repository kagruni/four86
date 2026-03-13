import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";

async function getConnectedWalletDocs(ctx: any, userId: string) {
  return ctx.db
    .query("connectedWallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
}

async function normalizePrimaryWallet(ctx: any, userId: string, primaryWalletId: any | null) {
  const wallets = await getConnectedWalletDocs(ctx, userId);
  for (const wallet of wallets) {
    const shouldBePrimary = primaryWalletId ? String(wallet._id) === String(primaryWalletId) : false;
    if (wallet.isPrimary !== shouldBePrimary) {
      await ctx.db.patch(wallet._id, {
        isPrimary: shouldBePrimary,
        updatedAt: Date.now(),
      });
    }
  }
}

export const upsertConnectedWallet = mutation({
  args: {
    userId: v.string(),
    walletId: v.optional(v.id("connectedWallets")),
    label: v.string(),
    hyperliquidAddress: v.string(),
    hyperliquidPrivateKey: v.string(),
    hyperliquidTestnet: v.boolean(),
    isActive: v.boolean(),
    isPrimary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingWallets = await getConnectedWalletDocs(ctx, args.userId);

    if (args.walletId) {
      const wallet = existingWallets.find((item: any) => String(item._id) === String(args.walletId));
      if (!wallet) {
        throw new Error("Connected wallet not found");
      }

      await ctx.db.patch(wallet._id, {
        label: args.label,
        hyperliquidAddress: args.hyperliquidAddress,
        hyperliquidPrivateKey: args.hyperliquidPrivateKey,
        hyperliquidTestnet: args.hyperliquidTestnet,
        isActive: args.isActive,
        isPrimary: args.isPrimary ?? wallet.isPrimary,
        updatedAt: now,
      });

      if (args.isPrimary ?? wallet.isPrimary) {
        await normalizePrimaryWallet(ctx, args.userId, wallet._id);
      }

      return wallet._id;
    }

    const isFirstWallet = existingWallets.length === 0;
    const walletId = await ctx.db.insert("connectedWallets", {
      userId: args.userId,
      label: args.label,
      hyperliquidAddress: args.hyperliquidAddress,
      hyperliquidPrivateKey: args.hyperliquidPrivateKey,
      hyperliquidTestnet: args.hyperliquidTestnet,
      isActive: args.isActive,
      isPrimary: args.isPrimary ?? isFirstWallet,
      createdAt: now,
      updatedAt: now,
    });

    if (args.isPrimary ?? isFirstWallet) {
      await normalizePrimaryWallet(ctx, args.userId, walletId);
    }

    return walletId;
  },
});

export const setConnectedWalletActive = mutation({
  args: {
    userId: v.string(),
    walletId: v.id("connectedWallets"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const wallet = await ctx.db.get(args.walletId);
    if (!wallet || wallet.userId !== args.userId) {
      throw new Error("Connected wallet not found");
    }

    await ctx.db.patch(args.walletId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });

    if (!args.isActive && wallet.isPrimary) {
      const remainingWallet = (await getConnectedWalletDocs(ctx, args.userId)).find(
        (item: any) => String(item._id) !== String(args.walletId) && item.isActive
      );
      await normalizePrimaryWallet(ctx, args.userId, remainingWallet?._id ?? null);
    }
  },
});

export const setPrimaryWallet = mutation({
  args: {
    userId: v.string(),
    walletId: v.id("connectedWallets"),
  },
  handler: async (ctx, args) => {
    const wallet = await ctx.db.get(args.walletId);
    if (!wallet || wallet.userId !== args.userId) {
      throw new Error("Connected wallet not found");
    }

    await ctx.db.patch(args.walletId, {
      isActive: true,
      isPrimary: true,
      updatedAt: Date.now(),
    });
    await normalizePrimaryWallet(ctx, args.userId, args.walletId);
  },
});

export const deleteConnectedWallet = mutation({
  args: {
    userId: v.string(),
    walletId: v.id("connectedWallets"),
  },
  handler: async (ctx, args) => {
    const wallet = await ctx.db.get(args.walletId);
    if (!wallet || wallet.userId !== args.userId) {
      throw new Error("Connected wallet not found");
    }

    const telegramSettings = await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .first();

    if (telegramSettings?.telegramMainWalletId && String(telegramSettings.telegramMainWalletId) === String(args.walletId)) {
      await ctx.db.patch(telegramSettings._id, {
        telegramMainWalletId: undefined,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.delete(args.walletId);

    if (wallet.isPrimary) {
      const nextPrimary = (await getConnectedWalletDocs(ctx, args.userId)).find((item: any) => item.isActive);
      if (nextPrimary) {
        await normalizePrimaryWallet(ctx, args.userId, nextPrimary._id);
      }
    }
  },
});

export const setTelegramMainWallet = mutation({
  args: {
    userId: v.string(),
    walletId: v.optional(v.id("connectedWallets")),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .first();

    if (args.walletId) {
      const wallet = await ctx.db.get(args.walletId);
      if (!wallet || wallet.userId !== args.userId) {
        throw new Error("Connected wallet not found");
      }
    }

    if (settings) {
      await ctx.db.patch(settings._id, {
        telegramMainWalletId: args.walletId,
        updatedAt: Date.now(),
      });
      return settings._id;
    }

    const now = Date.now();
    return ctx.db.insert("telegramSettings", {
      userId: args.userId,
      telegramMainWalletId: args.walletId,
      isLinked: false,
      isEnabled: true,
      notifyTradeOpened: true,
      notifyTradeClosed: true,
      notifyRiskAlerts: true,
      notifyDailySummary: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setTelegramMainWalletInternal = internalMutation({
  args: {
    userId: v.string(),
    walletId: v.optional(v.id("connectedWallets")),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .first();

    if (!settings) {
      return null;
    }

    await ctx.db.patch(settings._id, {
      telegramMainWalletId: args.walletId,
      updatedAt: Date.now(),
    });

    return settings._id;
  },
});
