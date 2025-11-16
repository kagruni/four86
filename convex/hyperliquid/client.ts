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
      const priceResponse = await fetch(`${baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "allMids",
        }),
      });

      const prices = await priceResponse.json();

      // Fetch candle data and calculate indicators for each symbol
      for (const symbol of args.symbols) {
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
            // Calculate RSI (14-period)
            rsi = calculateRSI(closePrices, 14);
          }

          if (closePrices.length >= 35) {
            // Calculate MACD (12, 26, 9)
            const macdData = calculateMACD(closePrices);
            macd = macdData.macd;
            macd_signal = macdData.signal;
          }

          if (closePrices.length >= 5) {
            // Short-term price change (last 4 periods = 4 hours)
            price_change_short = calculatePriceChange(closePrices, 4);
          }

          if (closePrices.length >= 25) {
            // Medium-term price change (last 24 periods = 24 hours/1 day)
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
          console.error(`Error calculating indicators for ${symbol}:`, error);

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
      }

      return marketData;
    } catch (error) {
      console.error("Error fetching market data:", error);
      throw new Error(`Failed to fetch market data: ${error}`);
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
      const response = await fetch(`${baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "clearinghouseState",
          user: args.address,
        }),
      });

      const data = await response.json();

      return {
        accountValue: parseFloat(data.marginSummary.accountValue),
        totalMarginUsed: parseFloat(data.marginSummary.totalMarginUsed),
        withdrawable: parseFloat(data.withdrawable),
        positions: data.assetPositions || [],
      };
    } catch (error) {
      console.error("Error fetching account state:", error);
      throw new Error(`Failed to fetch account state: ${error}`);
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
      };
    } catch (error) {
      console.error("Error closing position:", error);
      throw new Error(`Failed to close position: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});
