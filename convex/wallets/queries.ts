import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  getActiveConnectedWallets as resolveActiveConnectedWallets,
  getConnectedWallets as resolveConnectedWallets,
  getPrimaryWallet as resolvePrimaryWallet,
  getTelegramMainWallet as resolveTelegramMainWallet,
  getWalletById as resolveWalletById,
  resolveSelectedWallet as resolveWalletSelection,
} from "./resolver";

function sanitizeWallet(wallet: any) {
  if (!wallet) {
    return null;
  }

  return {
    _id: wallet.walletId,
    walletId: wallet.walletId,
    walletKey: wallet.walletKey,
    userId: wallet.userId,
    label: wallet.label,
    hyperliquidAddress: wallet.hyperliquidAddress,
    hyperliquidTestnet: wallet.hyperliquidTestnet,
    isActive: wallet.isActive,
    isPrimary: wallet.isPrimary,
    isLegacy: wallet.isLegacy,
  };
}

export const getConnectedWallets = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const wallets = await resolveConnectedWallets(ctx, args.userId);
    return wallets.map(sanitizeWallet);
  },
});

export const getActiveConnectedWallets = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const wallets = await resolveActiveConnectedWallets(ctx, args.userId);
    return wallets.map(sanitizeWallet);
  },
});

export const getWalletById = query({
  args: {
    userId: v.string(),
    walletId: v.optional(v.id("connectedWallets")),
  },
  handler: async (ctx, args) => {
    if (!args.walletId) {
      return null;
    }

    return sanitizeWallet(await resolveWalletById(ctx, args.userId, args.walletId));
  },
});

export const getPrimaryWallet = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => sanitizeWallet(await resolvePrimaryWallet(ctx, args.userId)),
});

export const getEffectiveTelegramMainWallet = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => sanitizeWallet(await resolveTelegramMainWallet(ctx, args.userId)),
});

export const resolveSelectedWallet = query({
  args: {
    userId: v.string(),
    walletId: v.optional(v.id("connectedWallets")),
  },
  handler: async (ctx, args) =>
    sanitizeWallet(await resolveWalletSelection(ctx, args.userId, args.walletId ?? null)),
});

export const getConnectedWalletsInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => resolveConnectedWallets(ctx, args.userId, { includePrivateKey: true }),
});

export const getActiveConnectedWalletsInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => resolveActiveConnectedWallets(ctx, args.userId, { includePrivateKey: true }),
});

export const getPrimaryWalletInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => resolvePrimaryWallet(ctx, args.userId, { includePrivateKey: true }),
});

export const getTelegramMainWalletInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => resolveTelegramMainWallet(ctx, args.userId, { includePrivateKey: true }),
});

export const getWalletByIdInternal = internalQuery({
  args: {
    userId: v.string(),
    walletId: v.optional(v.id("connectedWallets")),
  },
  handler: async (ctx, args) => {
    if (!args.walletId) {
      return null;
    }

    return resolveWalletById(ctx, args.userId, args.walletId, { includePrivateKey: true });
  },
});

export const resolveSelectedWalletInternal = internalQuery({
  args: {
    userId: v.string(),
    walletId: v.optional(v.id("connectedWallets")),
  },
  handler: async (ctx, args) =>
    resolveWalletSelection(ctx, args.userId, args.walletId ?? null, { includePrivateKey: true }),
});
