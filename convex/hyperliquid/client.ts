"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import * as sdk from "./sdk";
import { fetchCandlesInternal, extractClosePrices } from "./candles";
import {
  calculateRSI,
  calculateMACD,
  calculatePriceChange,
} from "../indicators/technicalIndicators";

/**
 * Fetch with retry for transient Hyperliquid API errors (502, 503, etc.)
 * Includes a per-request timeout (default 15s) via AbortController.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  timeoutMs = 15_000
): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok || attempt >= maxRetries) return response;

      const isTransient = [502, 503, 504, 429].includes(response.status);
      if (!isTransient) return response;

      const delayMs = 1000 * Math.pow(2, attempt - 1);
      console.log(`[fetchWithRetry] ${response.status} on attempt ${attempt}/${maxRetries}, retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === "AbortError") {
        console.log(`[fetchWithRetry] Timeout (${timeoutMs}ms) on attempt ${attempt}/${maxRetries}`);
        if (attempt >= maxRetries) throw new Error(`Request timed out after ${maxRetries} attempts`);
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error("[fetchWithRetry] Unreachable");
}

interface MarketData {
  symbol: string;
  price: number;
  volume_24h?: number;
  indicators: {
    rsi: number;
    macd: number;
    macd_signal: number;
    price_change_short: number;
    price_change_medium: number;
  };
}

// Get market data for trading symbols
export const getMarketData = action({
  args: {
    symbols: v.array(v.string()),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    const baseUrl = args.testnet
      ? "https://api.hyperliquid-testnet.xyz"
      : "https://api.hyperliquid.xyz";

    const marketData: Record<string, MarketData> = {};

    try {
      // Get all market prices
      const priceResponse = await fetchWithRetry(`${baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "allMids",
        }),
      });

      if (!priceResponse.ok) {
        throw new Error(`${priceResponse.status} ${priceResponse.statusText}`);
      }

      const prices = await priceResponse.json();

      // Fetch candle data and calculate indicators for ALL symbols in parallel
      await Promise.all(
        args.symbols.map(async (symbol) => {
          const price = parseFloat(prices[symbol] || "0");

          try {
            // Fetch 1-hour candles (need at least 50 for all indicators)
            const candles = await fetchCandlesInternal(
              symbol,
              "1h",
              100, // Fetch extra for better accuracy
              args.testnet
            );

            // Extract closing prices for indicator calculations
            const closePrices = extractClosePrices(candles);

            // Calculate real technical indicators
            let rsi = -1;
            let macd = -1;
            let macd_signal = -1;
            let price_change_short = 0;
            let price_change_medium = 0;

            if (closePrices.length >= 15) {
              rsi = calculateRSI(closePrices, 14);
            }

            if (closePrices.length >= 35) {
              const macdData = calculateMACD(closePrices);
              macd = macdData.macd;
              macd_signal = macdData.signal;
            }

            if (closePrices.length >= 5) {
              price_change_short = calculatePriceChange(closePrices, 4);
            }

            if (closePrices.length >= 25) {
              price_change_medium = calculatePriceChange(closePrices, 24);
            }

            marketData[symbol] = {
              symbol,
              price,
              indicators: {
                rsi,
                macd,
                macd_signal,
                price_change_short,
                price_change_medium,
              },
            };

            console.log(`Calculated indicators for ${symbol}:`, {
              rsi: rsi === -1 ? "insufficient data" : rsi.toFixed(2),
              macd: macd === -1 ? "insufficient data" : macd.toFixed(2),
              macd_signal: macd_signal === -1 ? "insufficient data" : macd_signal.toFixed(2),
              price_change_short: price_change_short.toFixed(2) + "%",
              price_change_medium: price_change_medium.toFixed(2) + "%",
              candles: closePrices.length,
            });
          } catch (error) {
            console.log(`Error calculating indicators for ${symbol}:`, error instanceof Error ? error.message : String(error));

            // Fallback to default values if indicator calculation fails
            marketData[symbol] = {
              symbol,
              price,
              indicators: {
                rsi: -1,
                macd: -1,
                macd_signal: -1,
                price_change_short: 0,
                price_change_medium: 0,
              },
            };
          }
        })
      );

      return marketData;
    } catch (error) {
      console.log("Error fetching market data:", error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to fetch market data: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Get account state
export const getAccountState = action({
  args: {
    address: v.string(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const baseUrl = args.testnet
      ? "https://api.hyperliquid-testnet.xyz"
      : "https://api.hyperliquid.xyz";

    try {
      const response = await fetchWithRetry(`${baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "clearinghouseState",
          user: args.address,
        }),
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      console.log("[getAccountState] Got response for:", args.address);

      // Extract account value - try multiple fields as the structure varies
      let accountValue = 0;

      // Try marginSummary.accountValue first
      if (data.marginSummary?.accountValue) {
        accountValue = parseFloat(data.marginSummary.accountValue);
      }
      // Fallback to crossMarginSummary.accountValue
      else if (data.crossMarginSummary?.accountValue) {
        accountValue = parseFloat(data.crossMarginSummary.accountValue);
      }
      // Last resort: use withdrawable balance
      else if (data.withdrawable) {
        accountValue = parseFloat(data.withdrawable);
      }

      const totalMarginUsed = data.marginSummary?.totalMarginUsed
        ? parseFloat(data.marginSummary.totalMarginUsed)
        : data.crossMarginSummary?.totalMarginUsed
          ? parseFloat(data.crossMarginSummary.totalMarginUsed)
          : 0;

      return {
        accountValue,
        totalMarginUsed,
        withdrawable: parseFloat(data.withdrawable || "0"),
        positions: data.assetPositions || [],
      };
    } catch (error) {
      console.warn("[getAccountState] API unavailable:", error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to fetch account state: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Place order
export const placeOrder = action({
  args: {
    privateKey: v.string(),
    address: v.string(),
    symbol: v.string(),
    isBuy: v.boolean(),
    size: v.number(),
    leverage: v.number(),
    price: v.optional(v.number()),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      // Get current market price if not provided
      let orderPrice = args.price;
      if (!orderPrice) {
        orderPrice = await sdk.getMarketPrice(args.symbol, args.testnet);
        console.log(`Using market price for ${args.symbol}: ${orderPrice}`);
      }

      // Set leverage before placing order
      await sdk.setLeverage(
        args.privateKey,
        args.symbol,
        args.leverage,
        args.testnet
      );

      // Place the order using the SDK
      const result = await sdk.placeOrder({
        privateKey: args.privateKey,
        symbol: args.symbol,
        isBuy: args.isBuy,
        size: args.size,
        price: orderPrice,
        testnet: args.testnet,
      });

      console.log("Order placed successfully:", {
        symbol: args.symbol,
        isBuy: args.isBuy,
        size: args.size,
        price: orderPrice,
        txHash: result.txHash,
      });

      return {
        success: result.success,
        price: orderPrice,
        txHash: result.txHash,
      };
    } catch (error) {
      console.error("Error placing order:", error);
      throw new Error(`Failed to place order: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Place stop-loss order
export const placeStopLoss = action({
  args: {
    privateKey: v.string(),
    symbol: v.string(),
    size: v.number(),
    triggerPrice: v.number(),
    isLongPosition: v.boolean(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const result = await sdk.placeStopLoss(
        args.privateKey,
        args.symbol,
        args.size,
        args.triggerPrice,
        args.isLongPosition,
        args.testnet
      );

      console.log("Stop-loss order placed successfully:", {
        symbol: args.symbol,
        size: args.size,
        triggerPrice: args.triggerPrice,
        txHash: result.txHash,
      });

      return {
        success: result.success,
        txHash: result.txHash,
      };
    } catch (error) {
      console.error("Error placing stop-loss:", error);
      throw new Error(`Failed to place stop-loss: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Place take-profit order
export const placeTakeProfit = action({
  args: {
    privateKey: v.string(),
    symbol: v.string(),
    size: v.number(),
    triggerPrice: v.number(),
    isLongPosition: v.boolean(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const result = await sdk.placeTakeProfit(
        args.privateKey,
        args.symbol,
        args.size,
        args.triggerPrice,
        args.isLongPosition,
        args.testnet
      );

      console.log("Take-profit order placed successfully:", {
        symbol: args.symbol,
        size: args.size,
        triggerPrice: args.triggerPrice,
        txHash: result.txHash,
      });

      return {
        success: result.success,
        txHash: result.txHash,
      };
    } catch (error) {
      console.error("Error placing take-profit:", error);
      throw new Error(`Failed to place take-profit: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Close position
export const closePosition = action({
  args: {
    privateKey: v.string(),
    address: v.string(),
    symbol: v.string(),
    size: v.number(),
    isBuy: v.boolean(), // Opposite of the current position side
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      // Get current market price for closing
      const closePrice = await sdk.getMarketPrice(args.symbol, args.testnet);

      // Close the position using the SDK
      const result = await sdk.closePosition({
        privateKey: args.privateKey,
        symbol: args.symbol,
        size: args.size,
        price: closePrice,
        isBuy: args.isBuy, // Opposite side to close
        testnet: args.testnet,
      });

      console.log("Position closed successfully:", {
        symbol: args.symbol,
        size: args.size,
        price: closePrice,
        txHash: result.txHash,
      });

      return {
        success: result.success,
        txHash: result.txHash,
        price: closePrice,
      };
    } catch (error) {
      console.error("Error closing position:", error);
      throw new Error(`Failed to close position: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Get user positions from Hyperliquid
// IMPORTANT: This action THROWS on API failure. Callers MUST catch errors.
// Returning [] on failure would be dangerous — executeClose and positionSync
// would mistake API failure for "no positions" and wipe the database.
export const getUserPositions = action({
  args: {
    address: v.string(),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    try {
      const positions = await sdk.getUserPositions(args.address, args.testnet);
      return positions;
    } catch (error) {
      console.warn("[getUserPositions] API unavailable:", error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to fetch user positions: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Get user open orders from Hyperliquid
// Returns empty array on API failure (graceful degradation for read-only queries)
export const getUserOpenOrders = action({
  args: {
    address: v.string(),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    try {
      const openOrders = await sdk.getUserOpenOrders(args.address, args.testnet);
      return openOrders;
    } catch (error) {
      console.warn("[getUserOpenOrders] API unavailable, returning empty:", error instanceof Error ? error.message : String(error));
      return [];
    }
  },
});

// Get frontend open orders (includes trigger orders like TP/SL)
// Returns empty array on API failure (graceful degradation for read-only queries)
export const getFrontendOpenOrders = action({
  args: {
    address: v.string(),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    try {
      return await sdk.getFrontendOpenOrders(args.address, args.testnet);
    } catch (error) {
      console.warn("[getFrontendOpenOrders] API unavailable, returning empty:", error instanceof Error ? error.message : String(error));
      return [];
    }
  },
});

// Verify TP/SL trigger orders exist on the exchange for a symbol
export const verifyTpSlOrders = action({
  args: {
    address: v.string(),
    symbol: v.string(),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    try {
      return await sdk.verifyTpSlOrders(args.address, args.symbol, args.testnet);
    } catch (error) {
      console.error("Error verifying TP/SL orders:", error);
      return { hasSl: false, hasTp: false, orders: [] };
    }
  },
});

// Cancel all orders for a symbol
export const cancelAllOrdersForSymbol = action({
  args: {
    privateKey: v.string(),
    address: v.string(),
    symbol: v.string(),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    try {
      const result = await sdk.cancelAllOrdersForSymbol(
        args.privateKey,
        args.address,
        args.symbol,
        args.testnet
      );
      return result;
    } catch (error) {
      console.log("Error cancelling orders:", error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to cancel orders: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Cancel a single order by ID
export const cancelOrder = action({
  args: {
    privateKey: v.string(),
    address: v.string(),
    symbol: v.string(),
    orderId: v.number(),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    try {
      const result = await sdk.cancelOrder(
        args.privateKey,
        args.address,
        args.symbol,
        args.orderId,
        args.testnet
      );
      return result;
    } catch (error) {
      console.log("Error cancelling order:", error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to cancel order: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// NUCLEAR CLOSE: Cancel all orders then close position
export const nuclearClosePosition = action({
  args: {
    privateKey: v.string(),
    address: v.string(),
    symbol: v.string(),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    try {
      const result = await sdk.nuclearClosePosition(
        args.privateKey,
        args.address,
        args.symbol,
        args.testnet
      );
      return result;
    } catch (error) {
      console.log("Error in nuclear close:", error instanceof Error ? error.message : String(error));
      throw new Error(`Nuclear close failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});
