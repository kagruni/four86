"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
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
} from "lucide-react";
import { useMutation } from "convex/react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export default function DashboardPage() {
  const { user } = useUser();
  const userId = user?.id || "";

  // Fetch data from Convex
  const botConfig = useQuery(api.queries.getBotConfig, { userId });
  const recentTrades = useQuery(api.queries.getRecentTrades, {
    userId,
    limit: 10
  });
  const aiLogs = useQuery(api.queries.getRecentAILogs, {
    userId,
    limit: 5
  });

  // Fetch LIVE positions with real-time prices
  const getLivePositions = useAction(api.queries.getLivePositions);
  const [positions, setPositions] = useState<any[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);

  // Mutation to toggle bot
  const toggleBot = useMutation(api.mutations.toggleBot);
  const [isToggling, setIsToggling] = useState(false);
  const { toast } = useToast();

  // Fetch live positions on mount and every 10 seconds
  useEffect(() => {
    if (!userId) return;

    const fetchLivePositions = async () => {
      setIsLoadingPositions(true);
      try {
        const livePositions = await getLivePositions({ userId });
        setPositions(livePositions);
      } catch (error) {
        console.error("Error fetching live positions:", error);
      } finally {
        setIsLoadingPositions(false);
      }
    };

    // Initial fetch
    fetchLivePositions();

    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchLivePositions, 10000);

    return () => clearInterval(interval);
  }, [userId, getLivePositions]);

  // Calculate P&L
  const currentCapital = botConfig?.currentCapital || 0;
  const startingCapital = botConfig?.startingCapital || 0;
  const totalPnl = currentCapital - startingCapital;
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
      console.error("Error toggling bot:", error);
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
      console.error("Error refreshing positions:", error);
      toast({
        title: "Error",
        description: "Failed to refresh live positions",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPositions(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-200px)] items-center justify-center">
        <div className="text-center">
          <Activity className="mx-auto h-12 w-12 animate-pulse text-black" />
          <p className="mt-4 text-sm text-gray-500">Loading dashboard...</p>
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
        <Card className="border-black">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-black">
              Current Capital
            </CardTitle>
            <DollarSign className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-black">
              {formatCurrency(currentCapital)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Starting: {formatCurrency(startingCapital)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-black">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-black">
              Total P&L
            </CardTitle>
            {totalPnl >= 0 ? (
              <TrendingUp className="h-4 w-4 text-black" />
            ) : (
              <TrendingDown className="h-4 w-4 text-black" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-black' : 'text-gray-600'}`}>
              {formatCurrency(totalPnl)}
            </div>
            <p className={`text-xs mt-1 ${totalPnlPct >= 0 ? 'text-black' : 'text-gray-500'}`}>
              {formatPercent(totalPnlPct)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-black">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-black">
              Open Positions
            </CardTitle>
            <Activity className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-black">
              {positions?.length || 0}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Active trades
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Positions Table */}
      <Card className="border-black">
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
            <div className="py-8 text-center text-sm text-gray-500">
              No open positions
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-black hover:bg-gray-50">
                  <TableHead className="text-black font-semibold">Symbol</TableHead>
                  <TableHead className="text-black font-semibold">Side</TableHead>
                  <TableHead className="text-black font-semibold">Size</TableHead>
                  <TableHead className="text-black font-semibold">Entry Price</TableHead>
                  <TableHead className="text-black font-semibold">Current Price</TableHead>
                  <TableHead className="text-black font-semibold">P&L</TableHead>
                  <TableHead className="text-black font-semibold">P&L %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => (
                  <TableRow
                    key={position._id}
                    className="border-gray-300 hover:bg-gray-50"
                  >
                    <TableCell className="font-medium text-black">
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
                    <TableCell className="text-black">
                      {position.size.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-black">
                      {formatCurrency(position.entryPrice)}
                    </TableCell>
                    <TableCell className="text-black">
                      {formatCurrency(position.currentPrice)}
                    </TableCell>
                    <TableCell className={position.unrealizedPnl >= 0 ? 'text-black font-medium' : 'text-gray-600'}>
                      {formatCurrency(position.unrealizedPnl)}
                    </TableCell>
                    <TableCell className={position.unrealizedPnlPct >= 0 ? 'text-black font-medium' : 'text-gray-600'}>
                      {formatPercent(position.unrealizedPnlPct)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Trades & AI Logs */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Recent Trades */}
        <Card className="border-black">
          <CardHeader>
            <CardTitle className="text-black">Recent Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {!recentTrades || recentTrades.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500">
                  No trades yet
                </div>
              ) : (
                <div className="space-y-4">
                  {recentTrades.map((trade) => (
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
                          <span className="font-medium text-black">
                            {trade.symbol}
                          </span>
                          <span className="text-sm text-gray-500">
                            {trade.side}
                          </span>
                        </div>
                        {trade.pnl !== undefined && (
                          <span className={`font-medium ${trade.pnl >= 0 ? 'text-black' : 'text-gray-600'}`}>
                            {formatCurrency(trade.pnl)}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-gray-500">
                        <div>Size: {trade.size.toFixed(4)} @ {formatCurrency(trade.price)}</div>
                        <div className="mt-1">{formatTimestamp(trade.executedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* AI Reasoning Log */}
        <Card className="border-black">
          <CardHeader>
            <CardTitle className="text-black">AI Reasoning</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {!aiLogs || aiLogs.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500">
                  No AI logs yet
                </div>
              ) : (
                <div className="space-y-4">
                  {aiLogs.map((log) => (
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
                      <p className="mt-2 text-sm text-black">
                        {log.reasoning}
                      </p>
                      {log.confidence !== undefined && (
                        <p className="mt-1 text-xs text-gray-500">
                          Confidence: {(log.confidence * 100).toFixed(0)}%
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
