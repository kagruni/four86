"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../fnRefs";

export const getSelectedWalletDashboardState = action({
  args: {
    userId: v.string(),
    walletId: v.optional(v.id("connectedWallets")),
  },
  handler: async (ctx, args) => {
    const wallet = await ctx.runQuery(internal.wallets.queries.resolveSelectedWalletInternal, {
      userId: args.userId,
      ...(args.walletId ? { walletId: args.walletId } : {}),
    });

    if (!wallet?.hyperliquidAddress) {
      return {
        wallet: null,
        accountState: null,
        openOrders: [],
      };
    }

    const [accountState, openOrders] = await Promise.all([
      ctx.runAction(api.hyperliquid.client.getAccountState, {
        address: wallet.hyperliquidAddress,
        testnet: wallet.hyperliquidTestnet,
      }),
      ctx.runAction(api.hyperliquid.client.getUserOpenOrders, {
        address: wallet.hyperliquidAddress,
        testnet: wallet.hyperliquidTestnet,
      }).catch(() => []),
    ]);

    return {
      wallet: {
        walletId: wallet.walletId ?? null,
        label: wallet.label,
        hyperliquidAddress: wallet.hyperliquidAddress,
        hyperliquidTestnet: wallet.hyperliquidTestnet,
      },
      accountState,
      openOrders: openOrders || [],
    };
  },
});
