"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SyncPositionsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const manualSync = useAction(api.testing.manualPositionSync.manualPositionSync);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleManualSync = async () => {
    try {
      setIsSyncing(true);
      const result = await manualSync();

      if (result.success) {
        toast({
          title: "Sync Complete",
          description: "Positions have been synced with Hyperliquid",
        });
      } else {
        toast({
          title: "Sync Failed",
          description: result.message || "Failed to sync positions",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast({
        title: "Error",
        description: "Failed to sync positions. Check console for details.",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Manual Position Sync</h1>
        <p className="text-gray-600 mt-2">
          Manually trigger position synchronization with Hyperliquid
        </p>
      </div>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900">Position Sync</CardTitle>
          <CardDescription className="text-gray-600">
            Click the button below to manually sync your positions with Hyperliquid.
            This will remove any positions from the database that are no longer on the exchange.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleManualSync}
            disabled={isSyncing || !user}
            className="bg-gray-900 text-white hover:bg-gray-800"
          >
            {isSyncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Now
              </>
            )}
          </Button>

          <div className="mt-4 text-sm text-gray-500">
            <p>
              <strong>Note:</strong> Automatic sync runs every 1 minute in the background.
              Use this manual sync if you need immediate synchronization.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
