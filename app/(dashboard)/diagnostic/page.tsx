"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function DiagnosticPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const checkPositions = useAction(api.testing.diagnosticPositions.checkPositionStatus);
  const recoverPositions = useAction(api.testing.recoverPositions.recoverMissingPositions);
  const [isChecking, setIsChecking] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleCheck = async () => {
    if (!user?.id) return;

    try {
      setIsChecking(true);
      setResult(null);

      const diagnosticResult = await checkPositions({ userId: user.id });
      setResult(diagnosticResult);

      if (diagnosticResult.error) {
        toast({
          title: "Diagnostic Failed",
          description: diagnosticResult.error,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Diagnostic Complete",
          description: `Found ${diagnosticResult.database.count} DB positions, ${diagnosticResult.hyperliquid.count} HL positions`,
        });
      }
    } catch (error) {
      console.error("Diagnostic error:", error);
      toast({
        title: "Error",
        description: "Failed to run diagnostic. Check console for details.",
        variant: "destructive",
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleRecover = async () => {
    if (!user?.id) return;

    try {
      setIsRecovering(true);

      const recoverResult = await recoverPositions({ userId: user.id });

      if (recoverResult.error) {
        toast({
          title: "Recovery Failed",
          description: recoverResult.error,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Recovery Complete",
          description: recoverResult.message,
        });
        // Re-run diagnostic to show updated results
        handleCheck();
      }
    } catch (error) {
      console.error("Recovery error:", error);
      toast({
        title: "Error",
        description: "Failed to recover positions. Check console for details.",
        variant: "destructive",
      });
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Position Diagnostic</h1>
        <p className="text-gray-600 mt-2">
          Compare database positions with Hyperliquid to find sync issues
        </p>
      </div>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900">Check Position Status</CardTitle>
          <CardDescription className="text-gray-600">
            This will compare your positions in the database vs Hyperliquid and show any mismatches.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button
              onClick={handleCheck}
              disabled={isChecking || !user}
              className="bg-gray-900 text-white hover:bg-gray-800"
            >
              {isChecking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Run Diagnostic
                </>
              )}
            </Button>

            {result && result.mismatches && result.mismatches.inHLNotDb.length > 0 && (
              <Button
                onClick={handleRecover}
                disabled={isRecovering || !user}
                variant="outline"
                className="border-green-600 text-green-700 hover:bg-green-50"
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Recovering...
                  </>
                ) : (
                  <>
                    <Wrench className="mr-2 h-4 w-4" />
                    Recover Missing Positions
                  </>
                )}
              </Button>
            )}
          </div>

          {result && !result.error && (
            <div className="space-y-4 mt-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border border-gray-200 rounded-lg">
                  <h3 className="font-semibold text-gray-900 mb-2">Database</h3>
                  <p className="text-2xl font-bold text-gray-900">{result.database.count}</p>
                  <p className="text-sm text-gray-600">positions</p>
                  {result.database.symbols.length > 0 && (
                    <div className="mt-2 text-sm text-gray-700">
                      {result.database.symbols.join(", ")}
                    </div>
                  )}
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <h3 className="font-semibold text-gray-900 mb-2">Hyperliquid</h3>
                  <p className="text-2xl font-bold text-gray-900">{result.hyperliquid.count}</p>
                  <p className="text-sm text-gray-600">positions</p>
                  {result.hyperliquid.symbols.length > 0 && (
                    <div className="mt-2 text-sm text-gray-700">
                      {result.hyperliquid.symbols.join(", ")}
                    </div>
                  )}
                </div>
              </div>

              {(result.mismatches.inHLNotDb.length > 0 || result.mismatches.inDbNotHL.length > 0) && (
                <Alert className="border-red-400 bg-red-50">
                  <AlertTitle className="text-red-800">Mismatches Found</AlertTitle>
                  <AlertDescription className="text-red-700">
                    {result.mismatches.inHLNotDb.length > 0 && (
                      <div className="mb-2">
                        <strong>On Hyperliquid but NOT in database:</strong>
                        <div className="ml-4">{result.mismatches.inHLNotDb.join(", ")}</div>
                      </div>
                    )}
                    {result.mismatches.inDbNotHL.length > 0 && (
                      <div>
                        <strong>In database but NOT on Hyperliquid:</strong>
                        <div className="ml-4">{result.mismatches.inDbNotHL.join(", ")}</div>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {result.mismatches.inHLNotDb.length === 0 && result.mismatches.inDbNotHL.length === 0 && (
                <Alert className="border-green-400 bg-green-50">
                  <AlertTitle className="text-green-800">✓ In Sync</AlertTitle>
                  <AlertDescription className="text-green-700">
                    Database and Hyperliquid positions match perfectly.
                  </AlertDescription>
                </Alert>
              )}

              {result.hyperliquid.raw && result.hyperliquid.raw.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-semibold text-gray-900 mb-2">Hyperliquid Position Details:</h4>
                  <pre className="bg-gray-100 p-4 rounded text-xs overflow-auto max-h-96">
                    {JSON.stringify(result.hyperliquid.raw, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
