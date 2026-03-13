"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LEGACY_WALLET_TOKEN = "legacy";

function toWalletToken(wallet: any) {
  return wallet?.walletId ? String(wallet.walletId) : LEGACY_WALLET_TOKEN;
}

export default function WalletSelector(props: {
  wallets: any[];
  selectedWalletToken: string | null;
  onChange: (token: string) => void;
  className?: string;
}) {
  const { wallets, selectedWalletToken, onChange, className } = props;

  if (!wallets || wallets.length === 0) {
    return null;
  }

  return (
    <Select value={selectedWalletToken ?? undefined} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select wallet" />
      </SelectTrigger>
      <SelectContent>
        {wallets.map((wallet: any) => (
          <SelectItem key={toWalletToken(wallet)} value={toWalletToken(wallet)}>
            {wallet.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
