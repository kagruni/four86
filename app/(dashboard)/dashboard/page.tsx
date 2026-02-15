"use client";

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
} from "lucide-react";
import { useMutation } from "convex/react";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

export default function DashboardPage() {
  const { user } = useUser();
  const userId = user?.id || "";

  // Fetch data from Convex
  const botConfig = useQuery(api.queries.getBotConfig, { userId });
  const userCredentials = useQuery(api.queries.getUserCredentials, { userId });
  const recentTrades = useQuery(api.queries.getRecentTrades, {
    userId,
    limit: 10
  });
  const aiLogs = useQuery(api.queries.getRecentAILogs, {
    userId,
    limit: 5
  });

  // Fetch LIVE positions with real-time prices
  const getLivePositions = useAction(api.liveQueries.getLivePositions);
  const [positions, setPositions] = useState<any[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);

  // Fetch open orders from Hyperliquid
  const getUserOpenOrders = useAction(api.hyperliquid.client.getUserOpenOrders);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  // Fetch live account state from Hyperliquid
  const getAccountState = useAction(api.hyperliquid.client.getAccountState);
  const [accountState, setAccountState] = useState<any>(null);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);

  // Mutation to toggle bot
  const toggleBot = useMutation(api.mutations.toggleBot);
  const [isToggling, setIsToggling] = useState(false);
  const { toast } = useToast();

  // Manual close position action
  const manualClosePosition = useAction(api.testing.manualTrigger.manualClosePosition);
  const [sellingPosition, setSellingPosition] = useState<string | null>(null);

  // Extract stable values from userCredentials
  const hyperliquidAddress = userCredentials?.hyperliquidAddress;
  const hyperliquidTestnet = userCredentials?.hyperliquidTestnet ?? true;

  // Fetch live positions, open orders, and account state on mount and every 10 seconds
  useEffect(() => {
    if (!userId || !hyperliquidAddress) {
      console.log("[Dashboard] Skipping data fetch:", { userId: !!userId, hyperliquidAddress: !!hyperliquidAddress });
      return;
    }

    console.log("[Dashboard] Fetching live data for address:", hyperliquidAddress);

    const fetchLiveData = async () => {
      setIsLoadingPositions(true);
      setIsLoadingOrders(true);
      setIsLoadingAccount(true);
      try {
        // Fetch positions, orders, and account state in parallel
        const [livePositions, orders, account] = await Promise.all([
          getLivePositions({ userId }),
          getUserOpenOrders({
            address: hyperliquidAddress,
            testnet: hyperliquidTestnet,
          }),
          getAccountState({
            address: hyperliquidAddress,
            testnet: hyperliquidTestnet,
          }),
        ]);
        console.log("[Dashboard] Fetched data:", {
          positions: Array.isArray(livePositions) ? livePositions.length : 0,
          orders: Array.isArray(orders) ? orders.length : 0,
          accountValue: account?.accountValue || 0
        });
        setPositions(Array.isArray(livePositions) ? livePositions : []);
        setOpenOrders(Array.isArray(orders) ? orders : []);
        setAccountState(account || null);
      } catch (error) {
        // Silently handle errors - use console.log to avoid triggering error overlay
        console.log("[Dashboard] Could not fetch live data, using defaults:", error instanceof Error ? error.message : String(error));
        // Set safe defaults on error
        setPositions([]);
        setOpenOrders([]);
        setAccountState(null);
      } finally {
        setIsLoadingPositions(false);
        setIsLoadingOrders(false);
        setIsLoadingAccount(false);
      }
    };

    // Initial fetch
    fetchLiveData();

    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchLiveData, 10000);

    return () => clearInterval(interval);
  }, [userId, hyperliquidAddress, hyperliquidTestnet, getLivePositions, getUserOpenOrders, getAccountState]);

  // Calculate P&L using live account value from Hyperliquid
  const liveAccountValue = accountState?.accountValue || 0;
  const startingCapital = botConfig?.startingCapital || 0;
  const totalPnl = liveAccountValue - startingCapital;
  const totalPnlPct = startingCapital > 0
    ? ((totalPnl / startingCapital) * 100)
    : 0;

  const isLoading = botConfig === undefined;
  const isBotActive = botConfig?.isActive || false;

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
          : "Your trading bot is now active and will execute trades every 3 minutes.",
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
    try {
      const livePositions = await getLivePositions({ userId });
      setPositions(livePositions);
      toast({
        title: "Refreshed",
        description: "Live positions updated from Hyperliquid",
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
    }
  };

  const handleSellPosition = async (position: any) => {
    if (!userId || sellingPosition) return;

    setSellingPosition(position.symbol);
    try {
      const result = await manualClosePosition({
        userId,
        symbol: position.symbol,
        size: position.sizeInCoins || position.size / position.entryPrice, // Size in coins
        side: position.side,
      });

      if (result.success) {
        toast({
          title: "Position Closed",
          description: `Successfully closed ${position.symbol} position`,
        });
        // Refresh positions after closing
        await handleRefreshPositions();
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to close position",
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

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-200px)] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-black" />
          <p className="mt-4 text-sm font-mono tracking-wide text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-black">Dashboard</h1>
          <p className="mt-2 text-sm text-gray-500">
            Monitor your AI trading bot performance
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <Badge
            variant={isBotActive ? "default" : "outline"}
            className={
              isBotActive
                ? "bg-black text-white border-black"
                : "bg-white text-black border-black"
            }
          >
            {isBotActive ? "ACTIVE" : "INACTIVE"}
          </Badge>
          <Button
            variant="outline"
            className="border-black text-black hover:bg-black hover:text-white"
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
            className={
              isBotActive
                ? "border-black text-black hover:bg-black hover:text-white"
                : "bg-black text-white hover:bg-gray-800"
            }
            onClick={handleToggleBot}
            disabled={isToggling}
          >
            {isToggling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isBotActive ? "Stopping..." : "Starting..."}
              </>
            ) : isBotActive ? (
              <>
                <PauseCircle className="mr-2 h-4 w-4" />
                Stop Bot
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                Start Bot
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Account Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Current Capital - Hero card with dark bg */}
        <motion.div
          className="h-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0 }}
        >
          <Card className="h-full bg-gray-950 text-white border border-gray-800 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-sm font-medium text-gray-300">
                  Current Capital
                </CardTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Live from Hyperliquid
                </p>
              </div>
              {isLoadingAccount ? (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              ) : (
                <DollarSign className="h-4 w-4 text-gray-400" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-mono font-bold tracking-tight text-white tabular-nums">
                {formatCurrency(liveAccountValue)}
              </div>
              <p className="text-xs text-gray-500 mt-1 font-mono tabular-nums">
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
          <Card className="h-full border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-sm font-medium text-black">
                  Total P&L
                </CardTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Live from Hyperliquid
                </p>
              </div>
              {isLoadingAccount ? (
                <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
              ) : totalPnl >= 0 ? (
                <TrendingUp className="h-4 w-4 text-black" />
              ) : (
                <TrendingDown className="h-4 w-4 text-black" />
              )}
            </CardHeader>
            <CardContent>
              <div className={`text-4xl font-mono font-bold tracking-tight tabular-nums ${totalPnl >= 0 ? 'text-black' : 'text-gray-600'}`}>
                {formatCurrency(totalPnl)}
              </div>
              <p className={`text-xs font-mono tabular-nums mt-1 ${totalPnlPct >= 0 ? 'text-black' : 'text-gray-500'}`}>
                {formatPercent(totalPnlPct)}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Open Positions */}
        <motion.div
          className="h-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <Card className="h-full border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-black">
                Open Positions
              </CardTitle>
              <Activity className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-mono font-bold tracking-tight text-black tabular-nums">
                {positions?.length || 0}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Active trades
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Positions Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 hover:shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-black">Open Positions</CardTitle>
                <p className="text-xs text-gray-500 mt-1">
                  Live prices from Hyperliquid • Auto-refreshes every 10s
                </p>
              </div>
              {isLoadingPositions && (
                <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!positions || positions.length === 0 ? (
              <div className="py-8 text-center text-sm font-mono text-gray-500">
                No open positions
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-black hover:bg-gray-50">
                      <TableHead className="text-black font-semibold">Symbol</TableHead>
                      <TableHead className="text-black font-semibold">Side</TableHead>
                      <TableHead className="text-black font-semibold">Leverage</TableHead>
                      <TableHead className="text-black font-semibold">Size (USD)</TableHead>
                      <TableHead className="text-black font-semibold">Entry</TableHead>
                      <TableHead className="text-black font-semibold">Current</TableHead>
                      <TableHead className="text-black font-semibold">Stop Loss</TableHead>
                      <TableHead className="text-black font-semibold">Take Profit</TableHead>
                      <TableHead className="text-black font-semibold">Liq. Price</TableHead>
                      <TableHead className="text-black font-semibold">P&L</TableHead>
                      <TableHead className="text-black font-semibold">P&L %</TableHead>
                      <TableHead className="text-black font-semibold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((position) => (
                      <TableRow
                        key={position._id}
                        className="border-gray-300 even:bg-gray-50/50 hover:bg-black/[0.02] transition-colors duration-150"
                      >
                        <TableCell className="font-mono font-semibold text-black">
                          {position.symbol}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              position.side === "LONG"
                                ? "border-black text-black bg-white"
                                : "border-gray-600 text-gray-600 bg-white"
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
                        <TableCell className="text-black font-mono font-medium tabular-nums">
                          {position.leverage}x
                        </TableCell>
                        <TableCell className="text-black font-mono tabular-nums">
                          {formatCurrency(position.size)}
                        </TableCell>
                        <TableCell className="text-black font-mono tabular-nums">
                          {formatPrice(position.entryPrice)}
                        </TableCell>
                        <TableCell className="text-black font-mono tabular-nums">
                          {formatPrice(position.currentPrice)}
                        </TableCell>
                        <TableCell className="text-red-600 font-mono font-medium text-xs tabular-nums">
                          {position.stopLoss ? formatPrice(position.stopLoss) : '-'}
                        </TableCell>
                        <TableCell className="text-green-600 font-mono font-medium text-xs tabular-nums">
                          {position.takeProfit ? formatPrice(position.takeProfit) : '-'}
                        </TableCell>
                        <TableCell className="text-gray-500 font-mono text-xs tabular-nums">
                          {position.liquidationPrice ? formatPrice(position.liquidationPrice) : '-'}
                        </TableCell>
                        <TableCell className={`font-mono tabular-nums ${position.unrealizedPnl >= 0 ? 'text-black font-medium' : 'text-gray-600'}`}>
                          {formatCurrency(position.unrealizedPnl)}
                        </TableCell>
                        <TableCell className={`font-mono tabular-nums ${position.unrealizedPnlPct >= 0 ? 'text-black font-medium' : 'text-gray-600'}`}>
                          {formatPercent(position.unrealizedPnlPct)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
                            onClick={() => handleSellPosition(position)}
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
                    ))}
                  </TableBody>
                </Table>
              </div>
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
        <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 hover:shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-black">Open Orders</CardTitle>
                <p className="text-xs text-gray-500 mt-1">
                  Pending orders on Hyperliquid • Auto-refreshes every 10s
                </p>
              </div>
              {isLoadingOrders && (
                <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!openOrders || openOrders.length === 0 ? (
              <div className="py-8 text-center text-sm font-mono text-gray-500">
                No open orders
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-black hover:bg-gray-50">
                      <TableHead className="text-black font-semibold">Symbol</TableHead>
                      <TableHead className="text-black font-semibold">Side</TableHead>
                      <TableHead className="text-black font-semibold">Type</TableHead>
                      <TableHead className="text-black font-semibold">Size</TableHead>
                      <TableHead className="text-black font-semibold">Limit Price</TableHead>
                      <TableHead className="text-black font-semibold">Trigger Price</TableHead>
                      <TableHead className="text-black font-semibold">Status</TableHead>
                      <TableHead className="text-black font-semibold">Order ID</TableHead>
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
                          className="border-gray-300 even:bg-gray-50/50 hover:bg-black/[0.02] transition-colors duration-150"
                        >
                          <TableCell className="font-mono font-semibold text-black">
                            {coin || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                isBuy
                                  ? "border-black text-black bg-white"
                                  : "border-gray-600 text-gray-600 bg-white"
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
                          <TableCell className="text-black text-xs">
                            {orderType}
                          </TableCell>
                          <TableCell className="text-black font-mono tabular-nums">
                            {sz || "-"}
                          </TableCell>
                          <TableCell className="text-black font-mono tabular-nums">
                            {limitPx ? formatPrice(parseFloat(limitPx)) : "-"}
                          </TableCell>
                          <TableCell className="text-black text-xs font-mono tabular-nums">
                            {triggerPx ? (
                              <div>
                                {triggerCondition && <div className="text-gray-500">{triggerCondition}</div>}
                                <div>{formatPrice(parseFloat(triggerPx))}</div>
                              </div>
                            ) : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                tpsl === "tp"
                                  ? "border-green-600 text-green-600 bg-white text-xs"
                                  : tpsl === "sl"
                                  ? "border-red-600 text-red-600 bg-white text-xs"
                                  : "border-gray-400 text-gray-600 bg-white text-xs"
                              }
                            >
                              {tpsl === "tp" ? "TP" : tpsl === "sl" ? "SL" : "Resting"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-gray-500 text-xs font-mono tabular-nums">
                            {oid ? oid.toString().substring(0, 10) + "..." : "-"}
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
          <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 hover:shadow-md">
            <CardHeader>
              <CardTitle className="text-black">Recent Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {!recentTrades || recentTrades.length === 0 ? (
                  <div className="py-8 text-center text-sm font-mono text-gray-500">
                    No trades yet
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentTrades.map((trade: Doc<"trades">) => (
                      <div key={trade._id} className="border-b border-gray-200 pb-4 last:border-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Badge
                              variant="outline"
                              className={
                                trade.side === "LONG"
                                  ? "border-black text-black bg-white"
                                  : "border-gray-600 text-gray-600 bg-white"
                              }
                            >
                              {trade.action === "OPEN" ? "OPEN" : "CLOSE"}
                            </Badge>
                            <span className="font-mono font-semibold text-black">
                              {trade.symbol}
                            </span>
                            <span className="text-sm text-gray-500">
                              {trade.side}
                            </span>
                          </div>
                          {trade.pnl !== undefined && (
                            <span className={`font-mono font-medium tabular-nums ${trade.pnl >= 0 ? 'text-black' : 'text-gray-600'}`}>
                              {formatCurrency(trade.pnl)}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 text-sm text-gray-500">
                          <div className="font-mono tabular-nums">Size: {trade.size.toFixed(4)} @ {formatCurrency(trade.price)}</div>
                          <div className="mt-1">{formatTimestamp(trade.executedAt)}</div>
                        </div>
                      </div>
                    ))}
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
          <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 hover:shadow-md">
            <CardHeader>
              <CardTitle className="text-black">AI Reasoning</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {!aiLogs || aiLogs.length === 0 ? (
                  <div className="py-8 text-center text-sm font-mono text-gray-500">
                    No AI logs yet
                  </div>
                ) : (
                  <div className="space-y-4">
                    {aiLogs.map((log: Doc<"aiLogs">) => (
                      <div key={log._id} className="border-b border-gray-200 pb-4 last:border-0">
                        <div className="flex items-center justify-between">
                          <Badge
                            variant="outline"
                            className="border-black text-black bg-white"
                          >
                            {log.decision}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {formatTimestamp(log.createdAt)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-black line-clamp-4">
                          {log.reasoning && log.reasoning.trim().startsWith("{")
                            ? "AI analysis completed — no high-conviction setups detected."
                            : log.reasoning}
                        </p>
                        {log.confidence !== undefined && (
                          <span className="mt-2 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-mono tabular-nums text-gray-700">
                            {(log.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
