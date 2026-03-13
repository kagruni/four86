"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Star } from "lucide-react";

export default function ConnectedWalletSettings() {
  const { user } = useUser();
  const { toast } = useToast();
  const userId = user?.id || "";
  const connectedWallets = useQuery(
    api.wallets.queries.getConnectedWallets,
    userId ? { userId } : "skip"
  );
  const activeWallets = useQuery(
    api.wallets.queries.getActiveConnectedWallets,
    userId ? { userId } : "skip"
  );

  const upsertConnectedWallet = useMutation(api.wallets.mutations.upsertConnectedWallet);
  const setConnectedWalletActive = useMutation(api.wallets.mutations.setConnectedWalletActive);
  const setPrimaryWallet = useMutation(api.wallets.mutations.setPrimaryWallet);
  const deleteConnectedWallet = useMutation(api.wallets.mutations.deleteConnectedWallet);

  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [testnet, setTestnet] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingWalletId, setPendingWalletId] = useState<string | null>(null);

  const handleAddWallet = async () => {
    if (!userId || !label || !address || !privateKey) {
      toast({
        title: "Missing fields",
        description: "Label, wallet address, and private key are required.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSaving(true);
      await upsertConnectedWallet({
        userId,
        label,
        hyperliquidAddress: address,
        hyperliquidPrivateKey: privateKey,
        hyperliquidTestnet: testnet,
      });
      setLabel("");
      setAddress("");
      setPrivateKey("");
      setTestnet(true);
      toast({
        title: "Wallet added",
        description: "The connected wallet is now available for copy trading.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add connected wallet.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetPrimary = async (walletId: string) => {
    try {
      setPendingWalletId(walletId);
      await setPrimaryWallet({ userId, walletId: walletId as any });
    } finally {
      setPendingWalletId(null);
    }
  };

  const handleToggleActive = async (walletId: string, isActive: boolean) => {
    try {
      setPendingWalletId(walletId);
      await setConnectedWalletActive({ userId, walletId: walletId as any, isActive });
    } finally {
      setPendingWalletId(null);
    }
  };

  const handleDelete = async (walletId: string) => {
    try {
      setPendingWalletId(walletId);
      await deleteConnectedWallet({ userId, walletId: walletId as any });
      toast({
        title: "Wallet removed",
        description: "The connected wallet was deleted.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete wallet.",
        variant: "destructive",
      });
    } finally {
      setPendingWalletId(null);
    }
  };

  return (
    <Card className="bg-background border border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Connected Wallets</CardTitle>
        <CardDescription className="text-muted-foreground">
          Manage the wallets that receive copy-traded executions. The primary wallet is used for strategy-state fallbacks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-foreground">Label</Label>
            <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Execution wallet 2" />
          </div>
          <div className="space-y-2">
            <Label className="text-foreground">Wallet Address</Label>
            <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x..." />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label className="text-foreground">Private Key</Label>
            <Input
              type="password"
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              placeholder="0x..."
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium text-foreground">Testnet</p>
              <p className="text-xs text-muted-foreground">Use testnet for this wallet.</p>
            </div>
            <Switch checked={testnet} onCheckedChange={setTestnet} />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleAddWallet} disabled={isSaving} className="bg-gray-900 text-white hover:bg-gray-800">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {isSaving ? "Saving..." : "Add Connected Wallet"}
          </Button>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-3">
          {(connectedWallets || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No connected wallet records yet. The legacy Hyperliquid credentials above will still be used as a fallback until you add one.
            </p>
          ) : (
            (connectedWallets || []).map((wallet) => (
              <div
                key={wallet.walletId ? String(wallet.walletId) : wallet.walletKey}
                className="rounded-md border border-border p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{wallet.label}</p>
                      {wallet.isPrimary && <Badge variant="secondary">Primary</Badge>}
                      {wallet.isLegacy && <Badge variant="outline">Legacy fallback</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{wallet.hyperliquidAddress}</p>
                    <p className="text-xs text-muted-foreground">
                      {wallet.hyperliquidTestnet ? "Testnet" : "Mainnet"} · {activeWallets?.some((item) => String(item.walletId ?? "legacy") === String(wallet.walletId ?? "legacy")) ? "Active" : "Inactive"}
                    </p>
                  </div>
                  {!wallet.isLegacy && wallet.walletId && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border"
                        disabled={pendingWalletId === String(wallet.walletId) || wallet.isPrimary}
                        onClick={() => handleSetPrimary(String(wallet.walletId))}
                      >
                        <Star className="mr-2 h-4 w-4" />
                        Make Primary
                      </Button>
                      <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
                        <span className="text-xs text-muted-foreground">Active</span>
                        <Switch
                          checked={wallet.isActive}
                          disabled={pendingWalletId === String(wallet.walletId)}
                          onCheckedChange={(checked) => handleToggleActive(String(wallet.walletId), checked)}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border text-red-600 hover:text-red-700"
                        disabled={pendingWalletId === String(wallet.walletId)}
                        onClick={() => handleDelete(String(wallet.walletId))}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
