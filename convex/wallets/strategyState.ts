import { api, internal } from "../fnRefs";
import { convertHyperliquidPositions } from "../trading/converters/positionConverter";

function normalizeWalletId(wallet: any) {
  return wallet?.walletId ?? undefined;
}

function preferPrimaryWalletRecord(existing: any, next: any, primaryWalletId: any) {
  const existingIsPrimary = String(existing?.walletId ?? "") === String(primaryWalletId ?? "");
  const nextIsPrimary = String(next?.walletId ?? "") === String(primaryWalletId ?? "");

  if (nextIsPrimary && !existingIsPrimary) {
    return next;
  }

  return existing ?? next;
}

export function dedupeRecentTradesByExecutionGroup(trades: any[]) {
  const seenGroups = new Set<string>();
  const deduped: any[] = [];

  for (const trade of trades || []) {
    const groupId = trade.executionGroupId ?? `${trade._id}`;
    if (seenGroups.has(groupId)) {
      continue;
    }
    seenGroups.add(groupId);
    deduped.push(trade);
  }

  return deduped;
}

export async function buildStrategyState(
  ctx: any,
  args: {
    userId: string;
    detailedMarketData: Record<string, any>;
  }
) {
  const [executionWallets, primaryWallet, recentTrades] = await Promise.all([
    ctx.runQuery(internal.wallets.queries.getActiveConnectedWalletsInternal, {
      userId: args.userId,
    }),
    ctx.runQuery(internal.wallets.queries.getPrimaryWalletInternal, {
      userId: args.userId,
    }),
    ctx.runQuery(api.queries.getRecentTrades, {
      userId: args.userId,
      limit: 200,
    }),
  ]);

  const walletStates = await Promise.all(
    (executionWallets || []).map(async (wallet: any) => {
      const walletId = normalizeWalletId(wallet);
      const [accountState, hyperliquidPositions, openOrders, dbPositions] = await Promise.all([
        ctx.runAction(api.hyperliquid.client.getAccountState, {
          address: wallet.hyperliquidAddress,
          testnet: wallet.hyperliquidTestnet,
        }),
        ctx.runAction(api.hyperliquid.client.getUserPositions, {
          address: wallet.hyperliquidAddress,
          testnet: wallet.hyperliquidTestnet,
        }),
        ctx.runAction(api.hyperliquid.client.getUserOpenOrders, {
          address: wallet.hyperliquidAddress,
          testnet: wallet.hyperliquidTestnet,
        }).catch(() => []),
        ctx.runQuery(api.queries.getPositions, {
          userId: args.userId,
          ...(walletId ? { walletId } : {}),
        }),
      ]);

      const positions = convertHyperliquidPositions(
        hyperliquidPositions || [],
        dbPositions || [],
        args.detailedMarketData
      ).map((position: any) => ({
        ...position,
        walletId,
        walletLabel: wallet.label,
      }));

      return {
        wallet,
        walletId,
        accountState,
        openOrders: (openOrders || []).map((order: any) => ({
          ...order,
          walletId,
          walletLabel: wallet.label,
        })),
        dbPositions: dbPositions || [],
        positions,
        hyperliquidPositions: hyperliquidPositions || [],
      };
    })
  );

  const primaryWalletId = normalizeWalletId(primaryWallet);
  const positionsBySymbol = new Map<string, any>();
  for (const walletState of walletStates) {
    for (const position of walletState.positions) {
      const current = positionsBySymbol.get(position.symbol);
      positionsBySymbol.set(
        position.symbol,
        preferPrimaryWalletRecord(current, position, primaryWalletId)
      );
    }
  }

  const openOrdersBySymbol = new Map<string, any>();
  for (const walletState of walletStates) {
    for (const order of walletState.openOrders) {
      const symbol = order.coin;
      const current = openOrdersBySymbol.get(symbol);
      openOrdersBySymbol.set(
        symbol,
        preferPrimaryWalletRecord(current, order, primaryWalletId)
      );
    }
  }

  const primaryWalletState =
    walletStates.find((state) => String(state.walletId ?? "") === String(primaryWalletId ?? "")) ??
    walletStates[0] ??
    null;

  return {
    executionWallets: executionWallets || [],
    primaryWallet,
    primaryWalletState,
    strategyAccountState: primaryWalletState?.accountState ?? null,
    positions: [...positionsBySymbol.values()],
    openOrders: [...openOrdersBySymbol.values()],
    recentTrades: dedupeRecentTradesByExecutionGroup(recentTrades || []),
    walletStates,
  };
}
