"use client";

import React from "react";
import { useUser } from "@clerk/nextjs";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  PlayCircle,
  PauseCircle,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  RefreshCw,
  X,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { useMutation } from "convex/react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useWalletSelection } from "@/hooks/use-wallet-selection";
import PositionChart from "./PositionChart";
import LiveChart from "./LiveChart";
import TradeDebugExportCard from "./TradeDebugExportCard";
import PreFlightPanel from "@/components/preflight/PreFlightPanel";
import WalletSelector from "@/components/wallets/WalletSelector";

function formatDebugJson(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `Could not serialize value: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function DashboardPageContent() {
  const { user } = useUser();
  const userId = user?.id || "";
  const {
    wallets,
    selectedWallet,
    selectedWalletToken,
    selectedWalletArgs,
    setSelectedWalletToken,
  } = useWalletSelection(userId);

  // Fetch data from Convex
  const botConfig = useQuery(api.queries.getBotConfig, { userId });
  const recentTrades = useQuery(api.queries.getRecentTrades, {
    userId,
    ...selectedWalletArgs,
    limit: 50
  });
  const allAiLogs = useQuery(api.queries.getRecentAILogs, {
    userId,
    limit: 50
  });
  const [aiLogsLimit, setAiLogsLimit] = useState(5);
  const aiLogs = allAiLogs?.slice(0, aiLogsLimit);
  const hasMoreAiLogs = (allAiLogs?.length ?? 0) > aiLogsLimit;

  const [tradesLimit, setTradesLimit] = useState(5);
  const visibleTrades = recentTrades?.slice(0, tradesLimit);
  const hasMoreTrades = (recentTrades?.length ?? 0) > tradesLimit;

  // Fetch LIVE positions with real-time prices
  const getLivePositions = useAction(api.liveQueries.getLivePositions);
  const [positions, setPositions] = useState<any[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);

  const getSelectedWalletDashboardState = useAction(api.dashboard.state.getSelectedWalletDashboardState);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [accountState, setAccountState] = useState<any>(null);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);

  // Mutation to toggle bot
  const toggleBot = useMutation(api.mutations.toggleBot);
  const [isToggling, setIsToggling] = useState(false);
  const { toast } = useToast();

  // Circuit breaker reset
  const resetCircuitBreaker = useMutation(api.mutations.resetCircuitBreaker);
  const [isResettingCB, setIsResettingCB] = useState(false);

  // Manual close position action
  const closeSymbolAcrossWallets = useAction(api.trading.manualCloseService.closeSymbolAcrossWallets);
  const closeAllSymbolsAcrossWallets = useAction(api.trading.manualCloseService.closeAllSymbolsAcrossWallets);
  const [sellingPosition, setSellingPosition] = useState<string | null>(null);

  // Close all positions state
  const [closingAll, setClosingAll] = useState(false);
  const [closeAllConfirm, setCloseAllConfirm] = useState(false);

  // Manual cancel order action
  const manualCancelOrder = useAction(api.testing.manualTrigger.manualCancelOrder);
  const [cancellingOrder, setCancellingOrder] = useState<number | null>(null);

  // Expanded position chart state
  const [expandedPosition, setExpandedPosition] = useState<string | null>(null);

  // Fetch live positions, open orders, and account state on mount and every 15 seconds
  // Uses a ref guard to prevent overlapping calls from stacking up
  const isFetchingRef = React.useRef(false);

  useEffect(() => {
    if (!userId || !selectedWallet) {
      console.log("[Dashboard] Skipping data fetch:", { userId: !!userId, selectedWallet: !!selectedWallet });
      return;
    }

    const fetchLiveData = async () => {
      // Skip if a previous fetch is still in progress
      if (isFetchingRef.current) {
        console.log("[Dashboard] Skipping fetch — previous call still in progress");
        return;
      }
      isFetchingRef.current = true;

      setIsLoadingPositions(true);
      setIsLoadingOrders(true);
      setIsLoadingAccount(true);
      try {
        // Fetch positions, orders, and account state in parallel
        const [livePositions, dashboardState] = await Promise.all([
          getLivePositions({ userId, ...selectedWalletArgs }),
          getSelectedWalletDashboardState({ userId, ...selectedWalletArgs }),
        ]);
        console.log("[Dashboard] Fetched data:", {
          positions: Array.isArray(livePositions) ? livePositions.length : 0,
          orders: Array.isArray(dashboardState?.openOrders) ? dashboardState.openOrders.length : 0,
          accountValue: dashboardState?.accountState?.accountValue || 0
        });
        setPositions(Array.isArray(livePositions) ? livePositions : []);
        setOpenOrders(Array.isArray(dashboardState?.openOrders) ? dashboardState.openOrders : []);
        setAccountState(dashboardState?.accountState || null);
      } catch (error) {
        // Silently handle errors - use console.log to avoid triggering error overlay
        console.log("[Dashboard] Could not fetch live data, using defaults:", error instanceof Error ? error.message : String(error));
        // Keep existing data on error instead of wiping to empty
      } finally {
        isFetchingRef.current = false;
        setIsLoadingPositions(false);
        setIsLoadingOrders(false);
        setIsLoadingAccount(false);
      }
    };

    // Initial fetch
    fetchLiveData();

    // Auto-refresh every 15 seconds (increased from 10s to reduce overlapping calls)
    const interval = setInterval(fetchLiveData, 15000);

    return () => clearInterval(interval);
  }, [getLivePositions, getSelectedWalletDashboardState, selectedWallet, selectedWalletArgs, userId]);

  // Calculate P&L using live account value from Hyperliquid
  const liveAccountValue = accountState?.accountValue || 0;
  const startingCapital = botConfig?.startingCapital || 0;
  const totalPnl = liveAccountValue - startingCapital;
  const totalPnlPct = startingCapital > 0
    ? ((totalPnl / startingCapital) * 100)
    : 0;

  // Today's P&L — fetch snapshots since start of today (UTC)
  const todayStart = React.useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }, []);
  const todaySnapshots = useQuery(
    api.queries.getAccountSnapshots,
    userId ? { userId, ...selectedWalletArgs, since: todayStart } : "skip"
  );
  const startOfDayValue = todaySnapshots && todaySnapshots.length > 0
    ? todaySnapshots[0].accountValue
    : null;
  const todayPnl = startOfDayValue !== null ? liveAccountValue - startOfDayValue : null;
  const todayPnlPct = startOfDayValue !== null && startOfDayValue > 0
    ? ((todayPnl! / startOfDayValue) * 100)
    : null;

  const isLoading = botConfig === undefined;
  const isBotActive = botConfig?.isActive || false;
  const effectiveTradingIntervalMinutes = botConfig?.tradingIntervalMinutes ?? 5;

  const handleToggleBot = async () => {
    if (!userId) return;

    setIsToggling(true);
    try {
      await toggleBot({
        userId,
        isActive: !isBotActive,
      });

      toast({
        title: isBotActive ? "Bot Stopped" : "Bot Started",
        description: isBotActive
          ? "Your trading bot has been deactivated."
          : `Your trading bot is now active and will execute trades every ${effectiveTradingIntervalMinutes} minute${effectiveTradingIntervalMinutes === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      console.log("Error toggling bot:", error instanceof Error ? error.message : String(error));
      toast({
        title: "Error",
        description: "Failed to toggle bot. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsToggling(false);
    }
  };

  const handleResetCircuitBreaker = async () => {
    if (!userId) return;
    setIsResettingCB(true);
    try {
      await resetCircuitBreaker({ userId });
      toast({
        title: "Circuit Breaker Reset",
        description: "Trading has been re-enabled. The bot will resume on the next cycle.",
      });
    } catch (error) {
      console.log("Error resetting circuit breaker:", error instanceof Error ? error.message : String(error));
      toast({
        title: "Error",
        description: "Failed to reset circuit breaker.",
        variant: "destructive",
      });
    } finally {
      setIsResettingCB(false);
    }
  };

  // Circuit breaker derived state
  const cbState = botConfig?.circuitBreakerState ?? "active";
  const cbIsTripped = cbState === "tripped";
  const cbIsCooldown = cbState === "cooldown";
  const cbTrippedAt = botConfig?.circuitBreakerTrippedAt;
  const cbCooldownMinutes = botConfig?.circuitBreakerCooldownMinutes ?? 30;
  const cbRemainingMinutes = cbTrippedAt
    ? Math.max(0, Math.ceil((cbCooldownMinutes * 60 * 1000 - (Date.now() - cbTrippedAt)) / 60000))
    : 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Format crypto prices with appropriate decimal places
  const formatPrice = (value: number) => {
    if (value < 1) {
      // For prices less than $1, show 4-5 decimal places
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 3,
        maximumFractionDigits: 5,
      }).format(value);
    } else if (value < 100) {
      // For prices $1-$100, show 3 decimal places
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 3,
      }).format(value);
    } else {
      // For prices $100+, show 2 decimal places
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    }
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const formatCoinSize = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: value < 1 ? 4 : 2,
      maximumFractionDigits: value < 1 ? 6 : 4,
    }).format(value);
  };

  const getRecentTradeSummary = (trade: Doc<"trades">) => {
    if (trade.action === "CLOSE") {
      if (trade.sizeInCoins !== undefined && trade.tradeValueUsd !== undefined) {
        return `Closed: ${formatCoinSize(trade.sizeInCoins)} ${trade.symbol} • Value: ${formatCurrency(trade.tradeValueUsd)} @ ${formatPrice(trade.price)}`;
      }
      return `Closed Value: ${formatCurrency(trade.size)} @ ${formatPrice(trade.price)}`;
    }

    return `Notional: ${formatCurrency(trade.size)} @ ${formatPrice(trade.price)}`;
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleRefreshPositions = async () => {
    if (!userId) return;
    setIsLoadingPositions(true);
    setIsLoadingOrders(true);
    setIsLoadingAccount(true);
    try {
      const [livePositions, dashboardState] = await Promise.all([
        getLivePositions({ userId, ...selectedWalletArgs }),
        getSelectedWalletDashboardState({ userId, ...selectedWalletArgs }),
      ]);
      setPositions(livePositions);
      setOpenOrders(Array.isArray(dashboardState?.openOrders) ? dashboardState.openOrders : []);
      setAccountState(dashboardState?.accountState || null);
      toast({
        title: "Refreshed",
        description: `Wallet data updated${selectedWallet ? ` for ${selectedWallet.label}` : ""}`,
      });
    } catch (error) {
      console.log("Error refreshing positions:", error instanceof Error ? error.message : String(error));
      toast({
        title: "Error",
        description: "Failed to refresh live positions",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPositions(false);
      setIsLoadingOrders(false);
      setIsLoadingAccount(false);
    }
  };

  const handleSellPosition = async (position: any) => {
    if (!userId || sellingPosition) return;

    setSellingPosition(position.symbol);
    try {
      const result = await closeSymbolAcrossWallets({
        userId,
        symbol: position.symbol,
        source: "dashboard",
      });

      if ((result?.closedWalletCount ?? 0) > 0) {
        toast({
          title: "Position Closed",
          description: `Closed ${position.symbol} on ${result.closedWalletCount}/${result.requestedWalletCount} wallet(s)`,
        });
        // Refresh positions after closing
        await handleRefreshPositions();
      } else {
        toast({
          title: "Error",
          description: result?.error || `Failed to close ${position.symbol} on any wallet`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.log("Error selling position:", error instanceof Error ? error.message : String(error));
      toast({
        title: "Error",
        description: "Failed to close position. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSellingPosition(null);
    }
  };

  const handleCloseAll = async () => {
    if (!userId || !positions || positions.length === 0 || closingAll) return;

    setClosingAll(true);
    setCloseAllConfirm(false);

    const result = await closeAllSymbolsAcrossWallets({
      userId,
      source: "dashboard",
    });

    const successCount = (result?.results || []).filter(
      (entry: any) => (entry.closedWalletCount ?? 0) > 0
    ).length;
    const failCount = (result?.results || []).filter(
      (entry: any) => (entry.closedWalletCount ?? 0) === 0
    ).length;

    if (failCount === 0 && successCount > 0) {
      toast({
        title: "All Positions Closed",
        description: `Processed ${successCount} symbol${successCount !== 1 ? "s" : ""} across all active wallets`,
      });
    } else {
      toast({
        title: "Close All Completed",
        description: `Processed ${successCount} symbol(s), ${failCount} failed`,
        variant: failCount > 0 ? "destructive" : "default",
      });
    }

    await handleRefreshPositions();
    setClosingAll(false);
  };

  const handleCancelOrder = async (coin: string, orderId: number) => {
    if (!userId || cancellingOrder !== null) return;

    setCancellingOrder(orderId);
    try {
      const result = await manualCancelOrder({
        userId,
        symbol: coin,
        orderId,
      });

      if (result.success) {
        toast({
          title: "Order Cancelled",
          description: `Cancelled ${coin} order #${orderId}`,
        });
        const dashboardState = await getSelectedWalletDashboardState({
          userId,
          ...selectedWalletArgs,
        });
        setOpenOrders(Array.isArray(dashboardState?.openOrders) ? dashboardState.openOrders : []);
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to cancel order",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.log("Error cancelling order:", error instanceof Error ? error.message : String(error));
      toast({
        title: "Error",
        description: "Failed to cancel order. Please try again.",
        variant: "destructive",
      });
    } finally {
      setCancellingOrder(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-200px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="mt-1 sm:mt-2 text-sm text-muted-foreground">
            Monitor your AI trading bot performance
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:space-x-4">
          <WalletSelector
            wallets={wallets}
            selectedWalletToken={selectedWalletToken}
            onChange={setSelectedWalletToken}
            className="w-full min-w-[220px] border-foreground text-foreground sm:w-[240px]"
          />
          <div className="flex items-center space-x-2 sm:space-x-4">
          <Badge
            variant={isBotActive ? "default" : "outline"}
            className={
              isBotActive
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-foreground border-foreground"
            }
          >
            {isBotActive ? "ACTIVE" : "INACTIVE"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="border-foreground text-foreground hover:bg-foreground hover:text-background"
            onClick={handleRefreshPositions}
            disabled={isLoadingPositions}
          >
            {isLoadingPositions ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant={isBotActive ? "outline" : "default"}
            size="sm"
            className={
              isBotActive
                ? "border-foreground text-foreground hover:bg-foreground hover:text-background"
                : "bg-foreground text-background hover:bg-foreground/80"
            }
            onClick={handleToggleBot}
            disabled={isToggling}
          >
            {isToggling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">{isBotActive ? "Stopping..." : "Starting..."}</span>
                <span className="sm:hidden">...</span>
              </>
            ) : isBotActive ? (
              <>
                <PauseCircle className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Stop Bot</span>
                <span className="sm:hidden">Stop</span>
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Start Bot</span>
                <span className="sm:hidden">Start</span>
              </>
            )}
          </Button>
          </div>
        </div>
      </div>

      {/* Circuit Breaker Status */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        <Card className={`border overflow-hidden transition-all duration-300 ${
          cbIsTripped
            ? "border-foreground bg-gray-950 dark:bg-gray-900 text-white"
            : cbIsCooldown
              ? "border-gray-300 bg-muted text-foreground"
              : "border-border bg-background text-foreground"
        }`}>
          <CardContent className="flex items-center justify-between py-3 px-5">
            <div className="flex items-center gap-3">
              {cbIsTripped ? (
                <ShieldAlert className="h-5 w-5 text-white shrink-0" />
              ) : cbIsCooldown ? (
                <ShieldAlert className="h-5 w-5 text-muted-foreground shrink-0" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <div>
                <p className="text-sm font-semibold">
                  {cbIsTripped
                    ? "Circuit Breaker Tripped — Trading Paused"
                    : cbIsCooldown
                      ? "Circuit Breaker Cooldown — Monitoring"
                      : "Circuit Breaker — OK"}
                </p>
                <p className={`text-xs mt-0.5 ${
                  cbIsTripped ? "text-muted-foreground" : "text-muted-foreground"
                }`}>
                  {cbIsTripped ? (
                    <>
                      {(botConfig?.consecutiveAiFailures ?? 0) > 0 &&
                        `${botConfig?.consecutiveAiFailures} consecutive AI failures. `}
                      {(botConfig?.consecutiveLosses ?? 0) > 0 &&
                        `${botConfig?.consecutiveLosses} consecutive losses. `}
                      {cbRemainingMinutes > 0
                        ? `Auto-resumes in ~${cbRemainingMinutes} min.`
                        : "Cooldown elapsed — will resume next cycle."}
                    </>
                  ) : cbIsCooldown ? (
                    "First trade after cooldown. Will reset to active on success."
                  ) : (
                    <>
                      AI failures: {botConfig?.consecutiveAiFailures ?? 0}/{botConfig?.maxConsecutiveAiFailures ?? 3}
                      {" · "}
                      Losses: {botConfig?.consecutiveLosses ?? 0}/{botConfig?.maxConsecutiveLosses ?? 5}
                    </>
                  )}
                </p>
              </div>
            </div>
            {(cbIsTripped || cbIsCooldown || (botConfig?.consecutiveLosses ?? 0) > 0 || (botConfig?.consecutiveAiFailures ?? 0) > 0) && (
              <Button
                variant={cbIsTripped ? "secondary" : "outline"}
                size="sm"
                className={cbIsTripped
                  ? "bg-background text-foreground hover:bg-gray-200 shrink-0"
                  : "border-gray-400 text-foreground hover:bg-gray-200 shrink-0"
                }
                onClick={handleResetCircuitBreaker}
                disabled={isResettingCB}
              >
                {isResettingCB ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                {isResettingCB ? "Resetting..." : cbIsTripped || cbIsCooldown ? "Reset" : "Reset Counters"}
              </Button>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Pre-Flight / Market Status Check */}
      {botConfig && (
        <PreFlightPanel
          symbols={botConfig.symbols || ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"]}
          testnet={selectedWallet?.hyperliquidTestnet ?? true}
          botActive={isBotActive}
        />
      )}

      {/* Account Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Current Capital - Hero card with dark bg */}
        <motion.div
          className="h-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0 }}
        >
          <Card className="h-full bg-gray-950 dark:bg-gray-900 text-white border border-border overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Current Capital
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live from Hyperliquid
                </p>
              </div>
              {isLoadingAccount ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-mono font-bold tracking-tight text-white tabular-nums">
                {formatCurrency(liveAccountValue)}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono tabular-nums">
                Starting: {formatCurrency(startingCapital)}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Total P&L */}
        <motion.div
          className="h-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <Card className="h-full border border-border overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-sm font-medium text-foreground">
                  Total P&L
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live from Hyperliquid
                </p>
              </div>
              {isLoadingAccount ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : totalPnl >= 0 ? (
                <TrendingUp className="h-4 w-4 text-foreground" />
              ) : (
                <TrendingDown className="h-4 w-4 text-foreground" />
              )}
            </CardHeader>
            <CardContent>
              <div className={`text-4xl font-mono font-bold tracking-tight tabular-nums ${totalPnl >= 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                {formatCurrency(totalPnl)}
              </div>
              <p className={`text-xs font-mono tabular-nums mt-1 ${totalPnlPct >= 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                {formatPercent(totalPnlPct)}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Today's P&L */}
        <motion.div
          className="h-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <Card className="h-full border border-border overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-sm font-medium text-foreground">
                  Today&apos;s P&L
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Since midnight
                </p>
              </div>
              {todayPnl === null ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : todayPnl >= 0 ? (
                <TrendingUp className="h-4 w-4 text-foreground" />
              ) : (
                <TrendingDown className="h-4 w-4 text-foreground" />
              )}
            </CardHeader>
            <CardContent>
              {todayPnl !== null ? (
                <>
                  <div className={`text-4xl font-mono font-bold tracking-tight tabular-nums ${todayPnl >= 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {formatCurrency(todayPnl)}
                  </div>
                  <p className={`text-xs font-mono tabular-nums mt-1 ${todayPnlPct !== null && todayPnlPct >= 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {todayPnlPct !== null ? formatPercent(todayPnlPct) : '—'}
                  </p>
                </>
              ) : (
                <div className="text-4xl font-mono font-bold tracking-tight tabular-nums text-muted-foreground">
                  —
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Open Positions */}
        <motion.div
          className="h-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <Card className="h-full border border-border overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">
                Open Positions
              </CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-mono font-bold tracking-tight text-foreground tabular-nums">
                {positions?.length || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Active trades
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Live Chart — always visible */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <LiveChart
          positions={positions}
          trades={recentTrades ?? []}
          testnet={selectedWallet?.hyperliquidTestnet ?? true}
        />
      </motion.div>

      {/* Positions Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <Card className="border border-border overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-foreground">Open Positions</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Live prices from Hyperliquid • Auto-refreshes every 10s
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isLoadingPositions && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {positions && positions.length > 0 && (
                  closeAllConfirm ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground hidden sm:inline">Close all {positions.length}?</span>
                      <Button
                        variant="default"
                        size="sm"
                        className="bg-red-600 text-white hover:bg-red-700 h-7 text-xs"
                        onClick={handleCloseAll}
                        disabled={closingAll}
                      >
                        {closingAll ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Confirm"
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setCloseAllConfirm(false)}
                        disabled={closingAll}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white h-7 text-xs"
                      onClick={() => setCloseAllConfirm(true)}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Close All
                    </Button>
                  )
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!positions || positions.length === 0 ? (
              <div className="py-8 text-center text-sm font-mono text-muted-foreground">
                No open positions
              </div>
            ) : (
              <>
                {/* Mobile: Card-based layout */}
                <div className="md:hidden space-y-3">
                  {positions.map((position) => {
                    const isExpanded = expandedPosition === position.symbol;
                    return (
                      <div key={position._id} className="border border-border overflow-hidden">
                        <button
                          type="button"
                          className={`w-full text-left p-3 transition-colors ${isExpanded ? "bg-muted" : "hover:bg-muted/50"}`}
                          onClick={() => setExpandedPosition(isExpanded ? null : position.symbol)}
                        >
                          {/* Row 1: Symbol, Side badge, P&L */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-block text-xs text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                              >
                                ▶
                              </span>
                              <span className="font-mono font-bold text-foreground text-sm">
                                {position.symbol}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 h-5 ${
                                  position.side === "LONG"
                                    ? "border-foreground text-foreground"
                                    : "border-gray-500 text-muted-foreground"
                                }`}
                              >
                                {position.side === "LONG" ? (
                                  <ArrowUpRight className="mr-0.5 h-2.5 w-2.5" />
                                ) : (
                                  <ArrowDownRight className="mr-0.5 h-2.5 w-2.5" />
                                )}
                                {position.side} {position.leverage}x
                              </Badge>
                              {position.exitMode === "managed_scalp_v2" && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-amber-500 text-amber-700 bg-amber-50">
                                  Managed
                                </Badge>
                              )}
                            </div>
                            <div className="text-right">
                              <span className={`font-mono font-semibold tabular-nums text-sm ${position.unrealizedPnl >= 0 ? "text-foreground" : "text-muted-foreground"}`}>
                                {formatCurrency(position.unrealizedPnl)}
                              </span>
                              <span className={`ml-1.5 font-mono tabular-nums text-xs ${position.unrealizedPnlPct >= 0 ? "text-foreground" : "text-muted-foreground"}`}>
                                {formatPercent(position.unrealizedPnlPct)}
                              </span>
                            </div>
                          </div>

                          {/* Row 2: Key prices in a compact grid */}
                          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums">
                            <div>
                              <span className="text-muted-foreground">Entry</span>
                              <div className="text-foreground">{formatPrice(position.entryPrice)}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Current</span>
                              <div className="text-foreground">{formatPrice(position.currentPrice)}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Size</span>
                              <div className="text-foreground">{formatCurrency(position.size)}</div>
                            </div>
                            {(position.managedStopPrice || position.stopLoss) && (
                              <div>
                                <span className="text-muted-foreground">{position.exitMode === "managed_scalp_v2" ? "MS" : "SL"}</span>
                                <div className="text-red-600">{formatPrice(position.managedStopPrice ?? position.stopLoss)}</div>
                              </div>
                            )}
                            {position.takeProfit && (
                              <div>
                                <span className="text-muted-foreground">TP</span>
                                <div className="text-green-600">{formatPrice(position.takeProfit)}</div>
                              </div>
                            )}
                            {position.liquidationPrice && (
                              <div>
                                <span className="text-muted-foreground">Liq</span>
                                <div className="text-muted-foreground">{formatPrice(position.liquidationPrice)}</div>
                              </div>
                            )}
                          </div>
                        </button>

                        {/* Sell button — always visible on mobile */}
                        <div className="flex items-center justify-end border-t border-border px-3 py-2 bg-muted/30">
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSellPosition(position);
                            }}
                            disabled={sellingPosition === position.symbol}
                          >
                            {sellingPosition === position.symbol ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <>
                                <X className="mr-1 h-3 w-3" />
                                Close Position
                              </>
                            )}
                          </Button>
                        </div>

                        {/* Expanded Chart */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{
                                height: { duration: 0.3, ease: "easeOut" as const },
                                opacity: { duration: 0.2, ease: "easeOut" as const },
                              }}
                              className="overflow-hidden border-t border-border bg-muted/50"
                            >
                              <div className="px-2 py-3">
                                <PositionChart
                                  symbol={position.symbol}
                                  entryPrice={position.entryPrice}
                                  currentPrice={position.currentPrice}
                                  stopLoss={position.stopLoss}
                                  managedStopPrice={position.managedStopPrice}
                                  takeProfit={position.takeProfit}
                                  liquidationPrice={position.liquidationPrice}
                                  side={position.side}
                                  testnet={selectedWallet?.hyperliquidTestnet ?? true}
                                  exitMode={position.exitMode}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop: Full table */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-muted">
                        <TableHead className="text-foreground font-semibold">Symbol</TableHead>
                        <TableHead className="text-foreground font-semibold">Side</TableHead>
                        <TableHead className="text-foreground font-semibold">Leverage</TableHead>
                        <TableHead className="text-foreground font-semibold">Size (USD)</TableHead>
                        <TableHead className="text-foreground font-semibold">Entry</TableHead>
                        <TableHead className="text-foreground font-semibold">Current</TableHead>
                        <TableHead className="text-foreground font-semibold">Stop Loss</TableHead>
                        <TableHead className="text-foreground font-semibold">Take Profit</TableHead>
                        <TableHead className="text-foreground font-semibold">Liq. Price</TableHead>
                        <TableHead className="text-foreground font-semibold">P&L</TableHead>
                        <TableHead className="text-foreground font-semibold">P&L %</TableHead>
                        <TableHead className="text-foreground font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.map((position) => {
                        const isExpanded = expandedPosition === position.symbol;
                        return (
                          <React.Fragment key={position._id}>
                            <TableRow
                              className={`border-border even:bg-muted/50 hover:bg-muted/30 transition-colors duration-150 cursor-pointer ${isExpanded ? "bg-muted" : ""}`}
                              onClick={() =>
                                setExpandedPosition(
                                  isExpanded ? null : position.symbol
                                )
                              }
                            >
                              <TableCell className="font-mono font-semibold text-foreground">
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`inline-block text-xs text-muted-foreground transition-transform duration-200 ${
                                      isExpanded ? "rotate-90" : ""
                                    }`}
                                  >
                                    ▶
                                  </span>
                                  {position.symbol}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    position.side === "LONG"
                                      ? "border-foreground text-foreground bg-background"
                                      : "border-gray-600 text-muted-foreground bg-background"
                                  }
                                >
                                  {position.side === "LONG" ? (
                                    <ArrowUpRight className="mr-1 h-3 w-3" />
                                  ) : (
                                    <ArrowDownRight className="mr-1 h-3 w-3" />
                                  )}
                                  {position.side}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-foreground font-mono font-medium tabular-nums">
                                {position.leverage}x
                              </TableCell>
                              <TableCell className="text-foreground font-mono tabular-nums">
                                {formatCurrency(position.size)}
                              </TableCell>
                              <TableCell className="text-foreground font-mono tabular-nums">
                                {formatPrice(position.entryPrice)}
                              </TableCell>
                              <TableCell className="text-foreground font-mono tabular-nums">
                                {formatPrice(position.currentPrice)}
                              </TableCell>
                              <TableCell className="text-red-600 font-mono font-medium text-xs tabular-nums">
                                {position.managedStopPrice || position.stopLoss ? formatPrice(position.managedStopPrice ?? position.stopLoss) : '-'}
                              </TableCell>
                              <TableCell className="text-green-600 font-mono font-medium text-xs tabular-nums">
                                {position.takeProfit ? formatPrice(position.takeProfit) : '-'}
                              </TableCell>
                              <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                                {position.liquidationPrice ? formatPrice(position.liquidationPrice) : '-'}
                              </TableCell>
                              <TableCell className={`font-mono tabular-nums ${position.unrealizedPnl >= 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                {formatCurrency(position.unrealizedPnl)}
                              </TableCell>
                              <TableCell className={`font-mono tabular-nums ${position.unrealizedPnlPct >= 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                {formatPercent(position.unrealizedPnlPct)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSellPosition(position);
                                  }}
                                  disabled={sellingPosition === position.symbol}
                                >
                                  {sellingPosition === position.symbol ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <X className="mr-1 h-3 w-3" />
                                      Sell
                                    </>
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {/* Expanded Chart Row */}
                            <AnimatePresence>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={12} className="p-0">
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{
                                        height: { duration: 0.3, ease: "easeOut" as const },
                                        opacity: { duration: 0.2, ease: "easeOut" as const },
                                      }}
                                      className="overflow-hidden border-t border-border bg-muted/50"
                                    >
                                      <div className="px-6 py-3">
                                        <PositionChart
                                          symbol={position.symbol}
                                          entryPrice={position.entryPrice}
                                          currentPrice={position.currentPrice}
                                          stopLoss={position.stopLoss}
                                          managedStopPrice={position.managedStopPrice}
                                          takeProfit={position.takeProfit}
                                          liquidationPrice={position.liquidationPrice}
                                          side={position.side}
                                          testnet={selectedWallet?.hyperliquidTestnet ?? true}
                                          exitMode={position.exitMode}
                                        />
                                      </div>
                                    </motion.div>
                                  </td>
                                </tr>
                              )}
                            </AnimatePresence>
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Open Orders Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <Card className="border border-border overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-foreground">Open Orders</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Pending orders on Hyperliquid • Auto-refreshes every 10s
                </p>
              </div>
              {isLoadingOrders && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!openOrders || openOrders.length === 0 ? (
              <div className="py-8 text-center text-sm font-mono text-muted-foreground">
                No open orders
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-muted">
                      <TableHead className="text-foreground font-semibold">Symbol</TableHead>
                      <TableHead className="text-foreground font-semibold">Side</TableHead>
                      <TableHead className="text-foreground font-semibold">Type</TableHead>
                      <TableHead className="text-foreground font-semibold">Size</TableHead>
                      <TableHead className="text-foreground font-semibold">Limit Price</TableHead>
                      <TableHead className="text-foreground font-semibold">Trigger Price</TableHead>
                      <TableHead className="text-foreground font-semibold">Status</TableHead>
                      <TableHead className="text-foreground font-semibold">Order ID</TableHead>
                      <TableHead className="text-foreground font-semibold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openOrders.map((order: any, index: number) => {
                      // Parse order data from Hyperliquid response
                      const isBuy = order.order?.side === "B" || order.side === "B";
                      const sz = order.order?.sz || order.sz;
                      const coin = order.coin;
                      const oid = order.oid;

                      // Determine if this is a trigger order (TP/SL)
                      const isTrigger = order.order?.trigger || order.trigger;
                      const limitPx = order.order?.limitPx || order.limitPx;
                      const triggerPx = order.order?.triggerPx || order.triggerPx;
                      const tpsl = isTrigger ? (order.order?.trigger?.tpsl || order.trigger?.tpsl) : null;

                      // Determine order type
                      let orderType = "Limit";
                      let triggerCondition = null;

                      if (isTrigger) {
                        if (tpsl === "sl") {
                          orderType = "Stop Market";
                          triggerCondition = isBuy ? "Price above" : "Price above";
                        } else if (tpsl === "tp") {
                          orderType = "Take Profit Market";
                          triggerCondition = isBuy ? "Price below" : "Price below";
                        } else {
                          orderType = "Trigger Market";
                        }
                      }

                      return (
                        <TableRow
                          key={oid || index}
                          className="border-border even:bg-muted/50 hover:bg-muted/30 transition-colors duration-150"
                        >
                          <TableCell className="font-mono font-semibold text-foreground">
                            {coin || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                isBuy
                                  ? "border-foreground text-foreground bg-background"
                                  : "border-gray-600 text-muted-foreground bg-background"
                              }
                            >
                              {isBuy ? (
                                <ArrowUpRight className="mr-1 h-3 w-3" />
                              ) : (
                                <ArrowDownRight className="mr-1 h-3 w-3" />
                              )}
                              {isBuy ? "BUY" : "SELL"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-foreground text-xs">
                            {orderType}
                          </TableCell>
                          <TableCell className="text-foreground font-mono tabular-nums">
                            {sz || "-"}
                          </TableCell>
                          <TableCell className="text-foreground font-mono tabular-nums">
                            {limitPx ? formatPrice(parseFloat(limitPx)) : "-"}
                          </TableCell>
                          <TableCell className="text-foreground text-xs font-mono tabular-nums">
                            {triggerPx ? (
                              <div>
                                {triggerCondition && <div className="text-muted-foreground">{triggerCondition}</div>}
                                <div>{formatPrice(parseFloat(triggerPx))}</div>
                              </div>
                            ) : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                tpsl === "tp"
                                  ? "border-green-600 text-green-600 bg-background text-xs"
                                  : tpsl === "sl"
                                  ? "border-red-600 text-red-600 bg-background text-xs"
                                  : "border-gray-400 text-muted-foreground bg-background text-xs"
                              }
                            >
                              {tpsl === "tp" ? "TP" : tpsl === "sl" ? "SL" : "Resting"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs font-mono tabular-nums">
                            {oid ? oid.toString().substring(0, 10) + "..." : "-"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
                              onClick={() => handleCancelOrder(coin, oid)}
                              disabled={!oid || cancellingOrder === oid}
                            >
                              {cancellingOrder === oid ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <X className="mr-1 h-3 w-3" />
                                  Cancel
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Trades & AI Logs */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Recent Trades */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        >
          <Card className="border border-border overflow-hidden">
            <CardHeader>
              <CardTitle className="text-foreground">Recent Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] pr-4">
                {!visibleTrades || visibleTrades.length === 0 ? (
                  <div className="py-8 text-center text-sm font-mono text-muted-foreground">
                    No trades yet
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visibleTrades.map((trade: Doc<"trades">) => (
                      <div key={trade._id} className="border-b border-border pb-4 last:border-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Badge
                              variant="outline"
                              className={
                                trade.side === "LONG"
                                  ? "border-foreground text-foreground bg-background"
                                  : "border-gray-600 text-muted-foreground bg-background"
                              }
                            >
                              {trade.action === "OPEN" ? "OPEN" : "CLOSE"}
                            </Badge>
                            <span className="font-mono font-semibold text-foreground">
                              {trade.symbol}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {trade.side}
                            </span>
                          </div>
                          {trade.pnl !== undefined && (
                            <span className={`font-mono font-medium tabular-nums ${trade.pnl >= 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {formatCurrency(trade.pnl)}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          <div className="font-mono tabular-nums">{getRecentTradeSummary(trade)}</div>
                          <div className="mt-1">{formatTimestamp(trade.executedAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {hasMoreTrades && (
                  <div className="flex justify-center pt-3 pb-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs border-border text-muted-foreground hover:text-foreground"
                      onClick={() => setTradesLimit((prev) => prev + 10)}
                    >
                      Load More
                    </Button>
                  </div>
              )}
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>

        {/* AI Reasoning Log */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.6 }}
        >
          <Card className="border border-border overflow-hidden">
            <CardHeader>
              <CardTitle className="text-foreground">AI Reasoning</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {!aiLogs || aiLogs.length === 0 ? (
                  <div className="py-8 text-center text-sm font-mono text-muted-foreground">
                    No AI logs yet
                  </div>
                ) : (
                  <Accordion type="multiple" className="w-full">
                    {aiLogs.map((log: Doc<"aiLogs">, index: number) => {
                      const parsedResponse = (log.parsedResponse ?? {}) as {
                        decisionTrace?: unknown;
                        executionResult?: {
                          executed?: boolean;
                          blockedBy?: string | null;
                          regimeValidation?: { reason?: string | null } | null;
                          trendValidation?: { reason?: string | null } | null;
                          positionValidation?: { reason?: string | null; checkName?: string | null } | null;
                        };
                      };
                      const executionResult = parsedResponse.executionResult;
                      const blockedBy = executionResult?.blockedBy ?? null;
                      const executionBlocked = Boolean(blockedBy);
                      const blockReason = blockedBy === "position_validator"
                        ? executionResult?.positionValidation?.reason || "Execution blocked by position validator"
                        : blockedBy === "trend_guard"
                        ? executionResult?.trendValidation?.reason || "Execution blocked by trend guard"
                        : blockedBy === "regime_validator"
                        ? executionResult?.regimeValidation?.reason || "Execution blocked by regime validator"
                        : blockedBy
                        ? `Execution blocked by ${blockedBy}`
                        : null;
                      const reasoningText = log.reasoning && log.reasoning.trim().startsWith("{")
                        ? "AI analysis completed — no high-conviction setups detected."
                        : log.reasoning;
                      return (
                        <AccordionItem key={log._id} value={`item-${index}`} className="border-b border-border last:border-0">
                          <AccordionTrigger className="hover:no-underline py-3 [&[data-state=open]>div>p]:hidden">
                            <div className="text-left w-full pr-2">
                              <div className="flex items-center justify-between">
                                <Badge
                                  variant="outline"
                                  className={
                                    executionBlocked
                                      ? "border-red-600 text-red-600 bg-background"
                                      : "border-foreground text-foreground bg-background"
                                  }
                                >
                                  {log.decision}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {formatTimestamp(log.createdAt)}
                                </span>
                              </div>
                              {executionBlocked && (
                                <div className="mt-2 flex items-center gap-2">
                                  <span className="inline-block rounded bg-red-50 px-2 py-0.5 text-xs font-mono text-red-700">
                                    BLOCKED
                                  </span>
                                  <span className="text-xs text-red-700">
                                    {blockReason}
                                  </span>
                                </div>
                              )}
                              <p className="mt-2 text-sm text-foreground line-clamp-4">
                                {reasoningText}
                              </p>
                              {log.confidence !== undefined && (
                                <span className="mt-2 inline-block rounded bg-muted px-2 py-0.5 text-xs font-mono tabular-nums text-foreground">
                                  {(log.confidence * 100).toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            {executionBlocked && (
                              <div className="mb-3 rounded border border-red-200 bg-red-50 p-3">
                                <div className="text-xs font-mono uppercase tracking-wide text-red-700">
                                  Execution Blocked
                                </div>
                                <div className="mt-1 text-sm text-red-800">
                                  {blockReason}
                                </div>
                                {executionResult?.positionValidation?.checkName && (
                                  <div className="mt-1 text-xs font-mono text-red-700">
                                    Validator: {executionResult.positionValidation.checkName}
                                  </div>
                                )}
                              </div>
                            )}
                            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                              {reasoningText}
                            </p>
                            {log.confidence !== undefined && (
                              <span className="mt-2 inline-block rounded bg-muted px-2 py-0.5 text-xs font-mono tabular-nums text-foreground">
                                {(log.confidence * 100).toFixed(0)}%
                              </span>
                            )}
                            <div className="mt-4 space-y-3">
                              <details className="rounded border border-border bg-muted/30 p-3">
                                <summary className="cursor-pointer text-xs font-mono uppercase tracking-wide text-muted-foreground">
                                  Stored Decision Trace
                                </summary>
                                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-xs text-foreground">
                                  {formatDebugJson(parsedResponse.decisionTrace ?? null)}
                                </pre>
                              </details>
                              <details className="rounded border border-border bg-muted/30 p-3">
                                <summary className="cursor-pointer text-xs font-mono uppercase tracking-wide text-muted-foreground">
                                  Rendered User Prompt
                                </summary>
                                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs text-foreground">
                                  {log.userPrompt}
                                </pre>
                              </details>
                              <details className="rounded border border-border bg-muted/30 p-3">
                                <summary className="cursor-pointer text-xs font-mono uppercase tracking-wide text-muted-foreground">
                                  Raw Model Response
                                </summary>
                                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs text-foreground">
                                  {log.rawResponse}
                                </pre>
                              </details>
                              <details className="rounded border border-border bg-muted/30 p-3">
                                <summary className="cursor-pointer text-xs font-mono uppercase tracking-wide text-muted-foreground">
                                  Parsed Response
                                </summary>
                                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-xs text-foreground">
                                  {formatDebugJson(log.parsedResponse ?? null)}
                                </pre>
                              </details>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                )}
                {hasMoreAiLogs && (
                  <div className="flex justify-center pt-3 pb-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs border-border text-muted-foreground hover:text-foreground"
                      onClick={() => setAiLogsLimit((prev) => prev + 10)}
                    >
                      Load More
                    </Button>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.7 }}
      >
        <TradeDebugExportCard userId={userId} />
      </motion.div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex h-[calc(100vh-200px)] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-foreground" />
        </div>
      }
    >
      <DashboardPageContent />
    </React.Suspense>
  );
}
