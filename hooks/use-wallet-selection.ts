"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const LEGACY_WALLET_TOKEN = "legacy";

function toWalletToken(wallet: any) {
  return wallet?.walletId ? String(wallet.walletId) : LEGACY_WALLET_TOKEN;
}

export function useWalletSelection(userId: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const urlWalletToken = searchParams.get("wallet");
  const wallets = useQuery(
    api.wallets.queries.getActiveConnectedWallets,
    userId ? { userId } : "skip"
  );
  const telegramMainWallet = useQuery(
    api.wallets.queries.getEffectiveTelegramMainWallet,
    userId ? { userId } : "skip"
  );
  const [selectedWalletToken, setSelectedWalletTokenState] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !wallets || wallets.length === 0) {
      return;
    }

    const storageKey = `four86:selected-wallet:${userId}`;
    const storedWalletToken =
      typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
    const validTokens = new Set(wallets.map((wallet: any) => toWalletToken(wallet)));
    const fallbackWalletToken = telegramMainWallet
      ? toWalletToken(telegramMainWallet)
      : toWalletToken(wallets[0]);

    const nextWalletToken =
      (urlWalletToken && validTokens.has(urlWalletToken) ? urlWalletToken : null) ??
      (storedWalletToken && validTokens.has(storedWalletToken) ? storedWalletToken : null) ??
      (validTokens.has(fallbackWalletToken) ? fallbackWalletToken : null) ??
      toWalletToken(wallets[0]);

    if (selectedWalletToken !== nextWalletToken) {
      setSelectedWalletTokenState(nextWalletToken);
    }

    if (typeof window !== "undefined") {
      if (window.localStorage.getItem(storageKey) !== nextWalletToken) {
        window.localStorage.setItem(storageKey, nextWalletToken);
      }
    }

    if (urlWalletToken !== nextWalletToken) {
      const nextParams = new URLSearchParams(searchParamsString);
      nextParams.set("wallet", nextWalletToken);
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
    }
  }, [
    pathname,
    router,
    searchParamsString,
    selectedWalletToken,
    telegramMainWallet,
    urlWalletToken,
    userId,
    wallets,
  ]);

  const selectedWallet = useMemo(() => {
    if (!wallets || wallets.length === 0 || !selectedWalletToken) {
      return null;
    }

    return (
      wallets.find((wallet: any) => toWalletToken(wallet) === selectedWalletToken) ??
      wallets[0]
    );
  }, [selectedWalletToken, wallets]);

  const selectedWalletArgs = useMemo(
    () => (selectedWallet?.walletId ? { walletId: selectedWallet.walletId } : {}),
    [selectedWallet]
  );

  const setSelectedWalletToken = (token: string) => {
    if (!userId) {
      return;
    }

    if (selectedWalletToken !== token) {
      setSelectedWalletTokenState(token);
    }
    const storageKey = `four86:selected-wallet:${userId}`;
    if (typeof window !== "undefined") {
      if (window.localStorage.getItem(storageKey) !== token) {
        window.localStorage.setItem(storageKey, token);
      }
    }

    if (urlWalletToken !== token) {
      const nextParams = new URLSearchParams(searchParamsString);
      nextParams.set("wallet", token);
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
    }
  };

  return {
    wallets: wallets || [],
    selectedWallet,
    selectedWalletToken,
    setSelectedWalletToken,
    selectedWalletArgs,
  };
}
