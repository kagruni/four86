"use client";

import { useUser } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Play, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useState } from "react";

export default function DebugPage() {
  const { user } = useUser();
  const userId = user?.id || "";

  const [testLog, setTestLog] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [aiDecision, setAiDecision] = useState<string | null>(null);

  // Queries
  const botConfig = useQuery(api.queries.getBotConfig, userId ? { userId } : "skip");
  const credentials = useQuery(api.queries.getUserCredentials, userId ? { userId } : "skip");
  const systemLogs = useQuery(api.queries.getRecentAILogs, userId ? { userId, limit: 5 } : "skip");

  // Actions
  const runTradingCycle = useAction(api.testing.manualTrigger.runTradingCycleForUser);

  const addLog = (message: string) => {
    setTestLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const runManualTest = async () => {
    if (!userId) {
      addLog("❌ User not loaded");
      return;
    }

    setIsRunning(true);
    setTestLog([]);
    setTestResult(null);
    setAiDecision(null);

    try {
      addLog("🚀 Starting manual trading loop test...");

      // Run the trading cycle
      const result = await runTradingCycle({ userId });

      // Display all logs from the backend
      if (result.logs) {
        result.logs.forEach((log: string) => addLog(log));
      }

      if (result.success) {
        setTestResult("success");
        if (result.decision) {
          setAiDecision(result.decision.decision);
        }
        addLog("✅ Test completed successfully!");
      } else {
        setTestResult("error");
        addLog(`❌ Test failed: ${result.error}`);
      }

    } catch (error) {
      addLog(`❌ Error: ${error}`);
      setTestResult("error");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Debug & Testing</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manually test the trading loop and view system diagnostics
        </p>
      </div>

      {/* Credentials Check */}
      <Card className="border-foreground">
        <CardHeader>
          <CardTitle className="text-foreground">Credentials Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">ZhipuAI API Key</span>
              <Badge
                variant={credentials?.hasZhipuaiApiKey ? "default" : "outline"}
                className={
                  credentials?.hasZhipuaiApiKey
                    ? "bg-foreground text-background"
                    : "border-gray-300 text-muted-foreground"
                }
              >
                {credentials?.hasZhipuaiApiKey ? (
                  <>
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Configured
                  </>
                ) : (
                  <>
                    <XCircle className="mr-1 h-3 w-3" />
                    Not Set
                  </>
                )}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">OpenRouter API Key</span>
              <Badge
                variant={credentials?.hasOpenrouterApiKey ? "default" : "outline"}
                className={
                  credentials?.hasOpenrouterApiKey
                    ? "bg-foreground text-background"
                    : "border-gray-300 text-muted-foreground"
                }
              >
                {credentials?.hasOpenrouterApiKey ? (
                  <>
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Configured
                  </>
                ) : (
                  <>
                    <XCircle className="mr-1 h-3 w-3" />
                    Not Set
                  </>
                )}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Hyperliquid Wallet</span>
              <Badge
                variant={credentials?.hasHyperliquidPrivateKey ? "default" : "outline"}
                className={
                  credentials?.hasHyperliquidPrivateKey
                    ? "bg-foreground text-background"
                    : "border-gray-300 text-muted-foreground"
                }
              >
                {credentials?.hasHyperliquidPrivateKey ? (
                  <>
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Configured
                  </>
                ) : (
                  <>
                    <XCircle className="mr-1 h-3 w-3" />
                    Not Set
                  </>
                )}
              </Badge>
            </div>

            {credentials?.hyperliquidAddress && (
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="text-sm text-foreground">Wallet Address</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {credentials.hyperliquidAddress.slice(0, 6)}...{credentials.hyperliquidAddress.slice(-4)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm text-foreground">Network</span>
              <Badge variant="outline" className="border-foreground text-foreground">
                {credentials?.hyperliquidTestnet ? "Testnet" : "Mainnet"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bot Configuration */}
      <Card className="border-foreground">
        <CardHeader>
          <CardTitle className="text-foreground">Bot Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          {!botConfig ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No bot configuration found. Please configure in Settings.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Status</span>
                <Badge
                  variant={botConfig.isActive ? "default" : "outline"}
                  className={
                    botConfig.isActive
                      ? "bg-foreground text-background"
                      : "border-gray-300 text-muted-foreground"
                  }
                >
                  {botConfig.isActive ? "ACTIVE" : "INACTIVE"}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">AI Model</span>
                <span className="text-sm text-muted-foreground">{botConfig.modelName}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Trading Symbols</span>
                <span className="text-sm text-muted-foreground">{botConfig.symbols.join(", ")}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Max Leverage</span>
                <span className="text-sm text-muted-foreground">{botConfig.maxLeverage}x</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Max Position Size</span>
                <span className="text-sm text-muted-foreground">{(botConfig.maxPositionSize * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Test */}
      <Card className="border-foreground">
        <CardHeader>
          <CardTitle className="text-foreground">Manual Trading Loop Test</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Alert className="border-border">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Test Mode</AlertTitle>
              <AlertDescription>
                This will manually trigger one trading cycle. The bot will fetch market data,
                make an AI decision, but will respect your bot&apos;s active/inactive status for order execution.
              </AlertDescription>
            </Alert>

            <Button
              onClick={runManualTest}
              disabled={isRunning || !credentials?.hasHyperliquidPrivateKey}
              className="w-full bg-foreground text-background hover:bg-foreground/80"
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running Test...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run Manual Test
                </>
              )}
            </Button>

            {/* AI Decision Result */}
            {aiDecision && (
              <div className="border-2 border-foreground bg-background p-4">
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-1">AI Decision</div>
                  <div className="text-2xl font-bold text-foreground">{aiDecision}</div>
                </div>
              </div>
            )}

            {/* Test Results */}
            {testResult && (
              <Alert
                className={
                  testResult === "success"
                    ? "border-foreground bg-background"
                    : "border-red-300 bg-red-50"
                }
              >
                {testResult === "success" ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-foreground" />
                    <AlertTitle className="text-foreground">Test Passed</AlertTitle>
                    <AlertDescription className="text-muted-foreground">
                      Trading loop completed successfully. Check the logs below.
                    </AlertDescription>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-red-600" />
                    <AlertTitle className="text-red-600">Test Failed</AlertTitle>
                    <AlertDescription className="text-red-600">
                      Trading loop encountered errors. Check the logs below.
                    </AlertDescription>
                  </>
                )}
              </Alert>
            )}

            {/* Test Log */}
            {testLog.length > 0 && (
              <div className="border border-border bg-muted p-4">
                <h4 className="text-sm font-semibold text-foreground mb-2">Test Log</h4>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-1 font-mono text-xs">
                    {testLog.map((log, i) => (
                      <div
                        key={i}
                        className={
                          log.includes("❌")
                            ? "text-red-600"
                            : log.includes("✅")
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        {log}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
