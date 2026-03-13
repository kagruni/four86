import { internalMutation } from "../_generated/server";

export const backfillConnectedWallets = internalMutation({
  handler: async (ctx) => {
    console.log("[migration] Starting: Backfill connected wallets");

    const credentials = await ctx.db.query("userCredentials").collect();
    let createdWallets = 0;
    let patchedPositions = 0;
    let patchedTrades = 0;
    let patchedSnapshots = 0;
    let patchedTelegramSettings = 0;

    for (const credential of credentials) {
      if (!credential.hyperliquidAddress || !credential.hyperliquidPrivateKey) {
        continue;
      }

      const existingWallets = await ctx.db
        .query("connectedWallets")
        .withIndex("by_userId", (q: any) => q.eq("userId", credential.userId))
        .collect();

      let primaryWallet = existingWallets.find((wallet: any) => wallet.isPrimary) ?? existingWallets[0];

      if (!primaryWallet) {
        const now = Date.now();
        const walletId = await ctx.db.insert("connectedWallets", {
          userId: credential.userId,
          label: "Primary wallet",
          hyperliquidAddress: credential.hyperliquidAddress,
          hyperliquidPrivateKey: credential.hyperliquidPrivateKey,
          hyperliquidTestnet: credential.hyperliquidTestnet,
          isActive: true,
          isPrimary: true,
          createdAt: now,
          updatedAt: now,
        });
        const insertedWallet = await ctx.db.get(walletId);
        if (insertedWallet) {
          primaryWallet = insertedWallet;
        }
        createdWallets += 1;
      }

      if (!primaryWallet) {
        continue;
      }

      const userPositions = await ctx.db
        .query("positions")
        .withIndex("by_userId", (q: any) => q.eq("userId", credential.userId))
        .collect();
      for (const position of userPositions) {
        if (!position.walletId) {
          await ctx.db.patch(position._id, { walletId: primaryWallet._id });
          patchedPositions += 1;
        }
      }

      const userTrades = await ctx.db
        .query("trades")
        .withIndex("by_userId", (q: any) => q.eq("userId", credential.userId))
        .collect();
      for (const trade of userTrades) {
        if (!trade.walletId) {
          await ctx.db.patch(trade._id, { walletId: primaryWallet._id });
          patchedTrades += 1;
        }
      }

      const userSnapshots = await ctx.db
        .query("accountSnapshots")
        .withIndex("by_userId", (q: any) => q.eq("userId", credential.userId))
        .collect();
      for (const snapshot of userSnapshots) {
        if (!snapshot.walletId) {
          await ctx.db.patch(snapshot._id, { walletId: primaryWallet._id });
          patchedSnapshots += 1;
        }
      }

      const telegramSettings = await ctx.db
        .query("telegramSettings")
        .withIndex("by_userId", (q: any) => q.eq("userId", credential.userId))
        .first();
      if (telegramSettings && !telegramSettings.telegramMainWalletId) {
        await ctx.db.patch(telegramSettings._id, {
          telegramMainWalletId: primaryWallet._id,
          updatedAt: Date.now(),
        });
        patchedTelegramSettings += 1;
      }
    }

    console.log("[migration] Complete: Backfill connected wallets");

    return {
      success: true,
      credentialRecords: credentials.length,
      createdWallets,
      patchedPositions,
      patchedTrades,
      patchedSnapshots,
      patchedTelegramSettings,
    };
  },
});
