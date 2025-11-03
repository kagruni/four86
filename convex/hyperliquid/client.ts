import { action } from "../_generated/server";
import { v } from "convex/values";

// Note: The hyperliquid package doesn't work well in Convex edge runtime
// So we'll use fetch API directly

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
  handler: async (ctx, args) => {
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

      // Get meta info for each symbol
      for (const symbol of args.symbols) {
        const price = parseFloat(prices[symbol] || "0");

        // Calculate mock indicators (in production, you'd fetch real data)
        // For now, we'll use simple calculations
        const rsi = 50 + (Math.random() * 40 - 20); // Mock RSI between 30-70
        const macd = Math.random() * 200 - 100;
        const macd_signal = macd * 0.9;
        const price_change_short = Math.random() * 6 - 3; // -3% to +3%
        const price_change_medium = Math.random() * 20 - 10; // -10% to +10%

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
    // Note: This is a placeholder. In production, you need to:
    // 1. Sign the order with the private key
    // 2. Send it to Hyperliquid's exchange endpoint
    // The hyperliquid SDK handles this, but it may not work in Convex edge runtime

    const baseUrl = args.testnet
      ? "https://api.hyperliquid-testnet.xyz"
      : "https://api.hyperliquid.xyz";

    try {
      // For now, return a mock response
      // TODO: Implement proper order signing and submission
      console.log("Order placed (mock):", {
        symbol: args.symbol,
        isBuy: args.isBuy,
        size: args.size,
        leverage: args.leverage,
      });

      return {
        success: true,
        price: args.price || 0,
        txHash: "mock_tx_hash",
      };
    } catch (error) {
      console.error("Error placing order:", error);
      throw new Error(`Failed to place order: ${error}`);
    }
  },
});

// Close position
export const closePosition = action({
  args: {
    privateKey: v.string(),
    address: v.string(),
    symbol: v.string(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Similar to placeOrder, this needs proper implementation
    // For now, returning mock response
    console.log("Position closed (mock):", args.symbol);

    return {
      success: true,
      txHash: "mock_close_tx_hash",
    };
  },
});
