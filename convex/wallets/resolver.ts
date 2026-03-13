export interface EffectiveWallet {
  _id?: any;
  walletId: any | null;
  walletKey: string;
  userId: string;
  label: string;
  hyperliquidAddress: string;
  hyperliquidPrivateKey?: string;
  hyperliquidTestnet: boolean;
  isActive: boolean;
  isPrimary: boolean;
  isLegacy: boolean;
}

function toConnectedWallet(wallet: any, includePrivateKey: boolean): EffectiveWallet {
  return {
    _id: wallet._id,
    walletId: wallet._id,
    walletKey: String(wallet._id),
    userId: wallet.userId,
    label: wallet.label,
    hyperliquidAddress: wallet.hyperliquidAddress,
    hyperliquidPrivateKey: includePrivateKey ? wallet.hyperliquidPrivateKey : undefined,
    hyperliquidTestnet: wallet.hyperliquidTestnet,
    isActive: wallet.isActive,
    isPrimary: wallet.isPrimary,
    isLegacy: false,
  };
}

function toLegacyWallet(credentials: any, userId: string, includePrivateKey: boolean): EffectiveWallet | null {
  if (!credentials?.hyperliquidAddress) {
    return null;
  }

  return {
    walletId: null,
    walletKey: `legacy:${credentials.hyperliquidAddress}`,
    userId,
    label: "Legacy wallet",
    hyperliquidAddress: credentials.hyperliquidAddress,
    hyperliquidPrivateKey: includePrivateKey ? credentials.hyperliquidPrivateKey : undefined,
    hyperliquidTestnet: credentials.hyperliquidTestnet ?? true,
    isActive: true,
    isPrimary: true,
    isLegacy: true,
  };
}

async function getLegacyCredentials(ctx: any, userId: string) {
  return ctx.db
    .query("userCredentials")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
}

export async function getConnectedWalletDocs(ctx: any, userId: string) {
  return ctx.db
    .query("connectedWallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
}

export async function getConnectedWallets(
  ctx: any,
  userId: string,
  options?: {
    includePrivateKey?: boolean;
    includeInactive?: boolean;
  }
) {
  const includePrivateKey = options?.includePrivateKey ?? false;
  const includeInactive = options?.includeInactive ?? true;
  const connectedWallets = await getConnectedWalletDocs(ctx, userId);
  const filtered = includeInactive
    ? connectedWallets
    : connectedWallets.filter((wallet: any) => wallet.isActive);

  return filtered.map((wallet: any) => toConnectedWallet(wallet, includePrivateKey));
}

export async function getActiveConnectedWallets(
  ctx: any,
  userId: string,
  options?: { includePrivateKey?: boolean }
) {
  const wallets = await getConnectedWallets(ctx, userId, {
    includePrivateKey: options?.includePrivateKey,
    includeInactive: false,
  });

  if (wallets.length > 0) {
    return wallets;
  }

  const legacyWallet = toLegacyWallet(
    await getLegacyCredentials(ctx, userId),
    userId,
    options?.includePrivateKey ?? false
  );
  return legacyWallet ? [legacyWallet] : [];
}

export async function getPrimaryWallet(
  ctx: any,
  userId: string,
  options?: { includePrivateKey?: boolean }
) {
  const wallets = await getConnectedWallets(ctx, userId, {
    includePrivateKey: options?.includePrivateKey,
    includeInactive: true,
  });

  const primaryWallet =
    wallets.find((wallet: EffectiveWallet) => wallet.isPrimary && wallet.isActive) ??
    wallets.find((wallet: EffectiveWallet) => wallet.isPrimary) ??
    wallets.find((wallet: EffectiveWallet) => wallet.isActive) ??
    wallets[0];

  if (primaryWallet) {
    return primaryWallet;
  }

  return toLegacyWallet(
    await getLegacyCredentials(ctx, userId),
    userId,
    options?.includePrivateKey ?? false
  );
}

export async function getWalletById(
  ctx: any,
  userId: string,
  walletId: any,
  options?: { includePrivateKey?: boolean }
) {
  if (!walletId) {
    return null;
  }

  const wallets = await getConnectedWallets(ctx, userId, {
    includePrivateKey: options?.includePrivateKey,
    includeInactive: true,
  });

  return wallets.find((wallet: EffectiveWallet) => String(wallet.walletId) === String(walletId)) ?? null;
}

export async function getTelegramMainWallet(
  ctx: any,
  userId: string,
  options?: { includePrivateKey?: boolean }
) {
  const settings = await ctx.db
    .query("telegramSettings")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();

  if (settings?.telegramMainWalletId) {
    const configuredWallet = await getWalletById(ctx, userId, settings.telegramMainWalletId, {
      includePrivateKey: options?.includePrivateKey,
    });
    if (configuredWallet?.isActive) {
      return configuredWallet;
    }
  }

  return getPrimaryWallet(ctx, userId, options);
}

export async function resolveSelectedWallet(
  ctx: any,
  userId: string,
  walletId: any,
  options?: { includePrivateKey?: boolean }
) {
  if (walletId) {
    const requestedWallet = await getWalletById(ctx, userId, walletId, {
      includePrivateKey: options?.includePrivateKey,
    });
    if (requestedWallet?.isActive) {
      return requestedWallet;
    }
  }

  const telegramWallet = await getTelegramMainWallet(ctx, userId, options);
  if (telegramWallet?.isActive) {
    return telegramWallet;
  }

  return getPrimaryWallet(ctx, userId, options);
}

export function walletMatchesRecord(record: any, walletId: any | undefined) {
  if (walletId === undefined) {
    return true;
  }

  const recordWalletId = record?.walletId ?? null;
  return String(recordWalletId) === String(walletId ?? null);
}

export function getWalletLabel(wallet: EffectiveWallet | null | undefined) {
  if (!wallet) {
    return "Unknown wallet";
  }

  return wallet.label || wallet.hyperliquidAddress;
}
