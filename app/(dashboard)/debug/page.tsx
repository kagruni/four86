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
        result.logs.forEach((log) => addLog(log));
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
        <h1 className="text-3xl font-bold text-black">Debug & Testing</h1>
        <p className="mt-2 text-sm text-gray-500">
          Manually test the trading loop and view system diagnostics
        </p>
      </div>

      {/* Credentials Check */}
      <Card className="border-black">
        <CardHeader>
          <CardTitle className="text-black">Credentials Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-black">ZhipuAI API Key</span>
              <Badge
                variant={credentials?.hasZhipuaiApiKey ? "default" : "outline"}
                className={
                  credentials?.hasZhipuaiApiKey
                    ? "bg-black text-white"
                    : "border-gray-300 text-gray-500"
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
              <span className="text-sm text-black">OpenRouter API Key</span>
              <Badge
                variant={credentials?.hasOpenrouterApiKey ? "default" : "outline"}
                className={
                  credentials?.hasOpenrouterApiKey
                    ? "bg-black text-white"
                    : "border-gray-300 text-gray-500"
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
              <span className="text-sm text-black">Hyperliquid Wallet</span>
              <Badge
                variant={credentials?.hasHyperliquidPrivateKey ? "default" : "outline"}
                className={
                  credentials?.hasHyperliquidPrivateKey
                    ? "bg-black text-white"
                    : "border-gray-300 text-gray-500"
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
              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <span className="text-sm text-black">Wallet Address</span>
                <span className="text-xs text-gray-500 font-mono">
                  {credentials.hyperliquidAddress.slice(0, 6)}...{credentials.hyperliquidAddress.slice(-4)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
              <span className="text-sm text-black">Network</span>
              <Badge variant="outline" className="border-black text-black">
                {credentials?.hyperliquidTestnet ? "Testnet" : "Mainnet"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bot Configuration */}
      <Card className="border-black">
        <CardHeader>
          <CardTitle className="text-black">Bot Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          {!botConfig ? (
            <div className="py-4 text-center text-sm text-gray-500">
              No bot configuration found. Please configure in Settings.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-black">Status</span>
                <Badge
                  variant={botConfig.isActive ? "default" : "outline"}
                  className={
                    botConfig.isActive
                      ? "bg-black text-white"
                      : "border-gray-300 text-gray-500"
                  }
                >
                  {botConfig.isActive ? "ACTIVE" : "INACTIVE"}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-black">AI Model</span>
                <span className="text-sm text-gray-600">{botConfig.modelName}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-black">Trading Symbols</span>
                <span className="text-sm text-gray-600">{botConfig.symbols.join(", ")}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-black">Max Leverage</span>
                <span className="text-sm text-gray-600">{botConfig.maxLeverage}x</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-black">Max Position Size</span>
                <span className="text-sm text-gray-600">{(botConfig.maxPositionSize * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Test */}
      <Card className="border-black">
        <CardHeader>
          <CardTitle className="text-black">Manual Trading Loop Test</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Alert className="border-gray-200">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Test Mode</AlertTitle>
              <AlertDescription>
                This will manually trigger one trading cycle. The bot will fetch market data,
                make an AI decision, but will respect your bot's active/inactive status for order execution.
              </AlertDescription>
            </Alert>

            <Button
              onClick={runManualTest}
              disabled={isRunning || !credentials?.hasHyperliquidPrivateKey}
              className="w-full bg-black text-white hover:bg-gray-800"
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
              <div className="rounded-lg border-2 border-black bg-white p-4">
                <div className="text-center">
                  <div className="text-sm text-gray-500 mb-1">AI Decision</div>
                  <div className="text-2xl font-bold text-black">{aiDecision}</div>
                </div>
              </div>
            )}

            {/* Test Results */}
            {testResult && (
              <Alert
                className={
                  testResult === "success"
                    ? "border-black bg-white"
                    : "border-red-300 bg-red-50"
                }
              >
                {testResult === "success" ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-black" />
                    <AlertTitle className="text-black">Test Passed</AlertTitle>
                    <AlertDescription className="text-gray-600">
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
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h4 className="text-sm font-semibold text-black mb-2">Test Log</h4>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-1 font-mono text-xs">
                    {testLog.map((log, i) => (
                      <div
                        key={i}
                        className={
                          log.includes("❌")
                            ? "text-red-600"
                            : log.includes("✅")
                            ? "text-black"
                            : "text-gray-600"
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
