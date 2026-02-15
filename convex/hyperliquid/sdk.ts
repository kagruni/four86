"use node";

import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";

// Cache for asset metadata (avoids repeated API calls)
let metadataCache: {
  universe: any[];
  ctx: any[];
  timestamp: number;
  testnet: boolean;
} | null = null;

const METADATA_CACHE_TTL = 60000; // 1 minute cache

/**
 * Retry wrapper for transient API failures (502, 503, 429, network errors).
 * Uses exponential backoff: 1s → 2s → 4s
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const msg = error?.message || String(error);
      const isTransient =
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("504") ||
        msg.includes("429") ||
        msg.includes("Bad Gateway") ||
        msg.includes("Service Unavailable") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("fetch failed");

      if (isTransient && attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.log(`[${label}] Transient error (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms: ${msg.slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`[${label}] Unreachable`);
}

// Symbol to Hyperliquid asset ID mapping (DEPRECATED - use getAssetId instead)
// These are fallback mainnet IDs - actual IDs are fetched from meta endpoint
const SYMBOL_TO_ASSET_ID: Record<string, number> = {
  BTC: 0,
  ETH: 1,
  SOL: 2,
  BNB: 3,
  DOGE: 4,
};

interface PlaceOrderParams {
  privateKey: string;
  symbol: string;
  isBuy: boolean;
  size: number;
  price: number;
  testnet: boolean;
  reduceOnly?: boolean;
  timeInForce?: "Gtc" | "Ioc" | "Alo"; // Good-Till-Cancel, Immediate-Or-Cancel, Add-Liquidity-Only
}

interface ClosePositionParams {
  privateKey: string;
  symbol: string;
  size: number;
  price: number;
  isBuy: boolean; // Opposite of the position side
  testnet: boolean;
}

/**
 * Get the Hyperliquid API URL based on testnet flag
 */
export function getHyperliquidUrl(testnet: boolean): string {
  return testnet
    ? "https://api.hyperliquid-testnet.xyz"
    : "https://api.hyperliquid.xyz";
}

/**
 * Fetch asset metadata from Hyperliquid
 * Returns universe (asset info) and ctx (market context) for all assets
 */
export async function getAssetMetadata(testnet: boolean): Promise<{
  universe: any[];
  ctx: any[];
}> {
  // Check cache first
  const now = Date.now();
  if (
    metadataCache &&
    metadataCache.testnet === testnet &&
    now - metadataCache.timestamp < METADATA_CACHE_TTL
  ) {
    return {
      universe: metadataCache.universe,
      ctx: metadataCache.ctx,
    };
  }

  // Fetch fresh metadata (with retry for transient failures)
  console.log(`[getAssetMetadata] Fetching metadata for ${testnet ? "testnet" : "mainnet"}...`);
  const [meta, ctx] = await withRetry(async () => {
    const infoClient = createInfoClient(testnet);
    return await infoClient.metaAndAssetCtxs();
  }, "getAssetMetadata");

  // Cache the result
  metadataCache = {
    universe: meta.universe,
    ctx,
    timestamp: now,
    testnet,
  };

  console.log(`[getAssetMetadata] Fetched ${meta.universe.length} assets`);
  return {
    universe: meta.universe,
    ctx,
  };
}

/**
 * Get asset ID and metadata from symbol
 * Queries the Hyperliquid meta endpoint to get correct asset ID for current network
 */
export async function getAssetInfo(
  symbol: string,
  testnet: boolean
): Promise<{
  assetId: number;
  szDecimals: number;
  maxLeverage: number;
}> {
  const { universe } = await getAssetMetadata(testnet);

  // Find asset by symbol
  const assetIndex = universe.findIndex((asset) => asset.name === symbol);
  if (assetIndex === -1) {
    throw new Error(`Asset ${symbol} not found in universe`);
  }

  const asset = universe[assetIndex];

  return {
    assetId: assetIndex,
    szDecimals: asset.szDecimals,
    maxLeverage: asset.maxLeverage,
  };
}

/**
 * Get asset ID from symbol (legacy function - uses hardcoded mapping as fallback)
 */
export function getAssetId(symbol: string): number {
  const assetId = SYMBOL_TO_ASSET_ID[symbol];
  if (assetId === undefined) {
    throw new Error(`Unknown symbol: ${symbol}`);
  }
  return assetId;
}

/**
 * Create a wallet from private key
 */
export function createWallet(privateKey: string) {
  // Ensure private key has 0x prefix
  const formattedKey = privateKey.startsWith("0x")
    ? privateKey
    : `0x${privateKey}`;
  return privateKeyToAccount(formattedKey as `0x${string}`);
}

/**
 * Create ExchangeClient instance
 */
export function createExchangeClient(
  privateKey: string,
  testnet: boolean
): hl.ExchangeClient {
  const wallet = createWallet(privateKey);

  // Configure transport with testnet flag
  const transport = new hl.HttpTransport({
    isTestnet: testnet, // This is the key property!
  });

  return new hl.ExchangeClient({
    wallet,
    transport,
  });
}

/**
 * Create InfoClient instance for market data
 */
export function createInfoClient(testnet: boolean): hl.InfoClient {
  // Configure transport with testnet flag
  const transport = new hl.HttpTransport({
    isTestnet: testnet, // This is the key property!
  });

  return new hl.InfoClient({
    transport,
  });
}

/**
 * Set leverage for an asset
 */
export async function setLeverage(
  privateKey: string,
  symbol: string,
  leverage: number,
  testnet: boolean
): Promise<void> {
  try {
    // Get correct asset ID from meta endpoint
    const assetInfo = await getAssetInfo(symbol, testnet);
    const exchangeClient = createExchangeClient(privateKey, testnet);

    console.log(`[setLeverage] Setting leverage for ${symbol} (asset ${assetInfo.assetId}) to ${leverage}x (max: ${assetInfo.maxLeverage}x)`);

    await exchangeClient.updateLeverage({
      asset: assetInfo.assetId,
      isCross: true, // Use cross margin (isolated = false)
      leverage,
    });

    console.log(`[setLeverage] Successfully set leverage for ${symbol} to ${leverage}x`);
  } catch (error) {
    console.error(`[setLeverage] Error setting leverage for ${symbol}:`, error);
    // Don't throw - continue with order even if leverage set fails
  }
}

/**
 * Place a limit order on Hyperliquid
 */
export async function placeOrder(
  params: PlaceOrderParams
): Promise<{ success: boolean; txHash: string; price: number }> {
  const { privateKey, symbol, isBuy, size, price, testnet, reduceOnly = false, timeInForce = "Gtc" } = params;

  try {
    // Get asset info with correct ID and szDecimals from meta endpoint
    const assetInfo = await getAssetInfo(symbol, testnet);
    const { assetId, szDecimals } = assetInfo;

    const exchangeClient = createExchangeClient(privateKey, testnet);

    // Format price and size according to Hyperliquid requirements
    // - Price: ≤5 significant figures, ≤(6 - szDecimals) decimals for perps
    // - Size: rounded to szDecimals
    const formattedPrice = formatPrice(price.toString(), szDecimals, true);
    const formattedSize = formatSize(size.toString(), szDecimals);

    // Log all parameters before creating order
    console.log(`[placeOrder] Input parameters:`, {
      symbol,
      assetId,
      szDecimals,
      isBuy,
      rawSize: size,
      rawPrice: price,
      formattedSize,
      formattedPrice,
      testnet,
      reduceOnly,
      timeInForce,
    });

    // Create order object
    const orderRequest = {
      orders: [
        {
          a: assetId, // Asset ID
          b: isBuy, // true = buy/long, false = sell/short
          p: formattedPrice, // Limit price (formatted string)
          s: formattedSize, // Size (formatted string)
          r: reduceOnly, // Reduce-only flag
          t: {
            limit: {
              tif: timeInForce, // Time-in-force: Gtc (default), Ioc (immediate), Alo (add liquidity)
            },
          },
        },
      ],
      grouping: "na" as const, // Not using order grouping
    };

    console.log(`[placeOrder] Order request object:`, JSON.stringify(orderRequest, null, 2));

    // Place the order (with retry for transient API failures)
    const result = await withRetry(
      () => exchangeClient.order(orderRequest),
      "placeOrder"
    );

    // Extract order ID from response
    const status = result?.response?.data?.statuses?.[0];
    let txHash = "pending";

    console.log(`[placeOrder] Raw response:`, JSON.stringify(result?.response?.data, null, 2)?.slice(0, 500));

    if (status) {
      if ("error" in status) {
        console.error(`[placeOrder] Order rejected by Hyperliquid:`, status.error);
        throw new Error(`Order rejected: ${status.error}`);
      }
      if ("filled" in status) {
        txHash = `filled_${status.filled.oid}`;
        console.log(`[placeOrder] Order FILLED: oid=${status.filled.oid}, totalSz=${status.filled.totalSz}, avgPx=${status.filled.avgPx}`);
      } else if ("resting" in status) {
        txHash = `resting_${status.resting.oid}`;
        console.log(`[placeOrder] Order RESTING: oid=${status.resting.oid}`);
      }
    } else {
      console.warn(`[placeOrder] No status in response - order may not have been placed`);
    }

    return {
      success: true,
      txHash,
      price,
    };
  } catch (error) {
    console.error("Error placing order on Hyperliquid:", error);
    throw new Error(`Failed to place order: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Place a stop-loss order (trigger order that closes position when price hits stop level)
 */
export async function placeStopLoss(
  privateKey: string,
  symbol: string,
  size: number,
  triggerPrice: number,
  isLongPosition: boolean,
  testnet: boolean
): Promise<{ success: boolean; txHash: string }> {
  try {
    // Get asset info
    const assetInfo = await getAssetInfo(symbol, testnet);
    const { assetId, szDecimals } = assetInfo;

    const exchangeClient = createExchangeClient(privateKey, testnet);

    // Format trigger price and size (isPerp=true for perpetual futures)
    const formattedTriggerPrice = formatPrice(triggerPrice.toString(), szDecimals, true);
    const formattedSize = formatSize(size.toString(), szDecimals);

    console.log(`[placeStopLoss] Placing stop-loss for ${symbol}:`, {
      assetId,
      size: formattedSize,
      triggerPrice: formattedTriggerPrice,
      isLongPosition,
    });

    // For LONG positions: sell when price drops (b=false)
    // For SHORT positions: buy when price rises (b=true)
    const orderRequest = {
      orders: [
        {
          a: assetId,
          b: !isLongPosition, // Opposite side to close position
          s: formattedSize,
          r: true, // Reduce-only (only close, don't open reverse position)
          p: formattedTriggerPrice, // Limit price (same as trigger for market-like execution)
          t: {
            trigger: {
              isMarket: true, // Execute at market when triggered (10% slippage)
              tpsl: "sl" as const, // Stop loss
              triggerPx: formattedTriggerPrice,
            },
          },
        },
      ],
      grouping: "positionTpsl" as const, // Position-level TP/SL — adjusts with position size
    };

    console.log(`[placeStopLoss] Order request:`, JSON.stringify(orderRequest, null, 2));

    // Retry the exchange call for transient API failures (502, 503, etc.)
    const result = await withRetry(
      () => exchangeClient.order(orderRequest),
      "placeStopLoss"
    );

    // Log full response for debugging
    console.log(`[placeStopLoss] Full API response:`, JSON.stringify(result, null, 2));

    // Extract order ID - check for various status types
    const status = result?.response?.data?.statuses?.[0];
    let txHash = "pending";

    if (status) {
      if ("error" in status) {
        console.error(`[placeStopLoss] Order error:`, status.error);
        throw new Error(`Stop loss order failed: ${status.error}`);
      } else if ("filled" in status) {
        txHash = `sl_filled_${status.filled.oid}`;
      } else if ("resting" in status) {
        txHash = `sl_resting_${status.resting.oid}`;
      } else {
        console.log(`[placeStopLoss] Unknown status type:`, status);
      }
    } else {
      console.error(`[placeStopLoss] No status in response — order may not have been placed`);
      console.error(`[placeStopLoss] Full result keys:`, Object.keys(result || {}));
      throw new Error(`Stop loss order returned no status — API response missing statuses`);
    }

    console.log(`[placeStopLoss] Successfully placed stop-loss order: ${txHash}`);

    return {
      success: true,
      txHash,
    };
  } catch (error) {
    console.error(`[placeStopLoss] Error:`, error);
    throw new Error(`Failed to place stop-loss: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Place a take-profit order (trigger order that closes position when price hits target)
 */
export async function placeTakeProfit(
  privateKey: string,
  symbol: string,
  size: number,
  triggerPrice: number,
  isLongPosition: boolean,
  testnet: boolean
): Promise<{ success: boolean; txHash: string }> {
  try {
    // Get asset info
    const assetInfo = await getAssetInfo(symbol, testnet);
    const { assetId, szDecimals } = assetInfo;

    const exchangeClient = createExchangeClient(privateKey, testnet);

    // Format trigger price and size (isPerp=true for perpetual futures)
    const formattedTriggerPrice = formatPrice(triggerPrice.toString(), szDecimals, true);
    const formattedSize = formatSize(size.toString(), szDecimals);

    console.log(`[placeTakeProfit] Placing take-profit for ${symbol}:`, {
      assetId,
      size: formattedSize,
      triggerPrice: formattedTriggerPrice,
      isLongPosition,
    });

    // For LONG positions: sell when price rises (b=false)
    // For SHORT positions: buy when price drops (b=true)
    const orderRequest = {
      orders: [
        {
          a: assetId,
          b: !isLongPosition, // Opposite side to close position
          s: formattedSize,
          r: true, // Reduce-only
          p: formattedTriggerPrice, // Limit price
          t: {
            trigger: {
              isMarket: true, // Execute at market when triggered
              tpsl: "tp" as const, // Take profit
              triggerPx: formattedTriggerPrice,
            },
          },
        },
      ],
      grouping: "positionTpsl" as const, // Position-level TP/SL — adjusts with position size
    };

    console.log(`[placeTakeProfit] Order request:`, JSON.stringify(orderRequest, null, 2));

    // Retry the exchange call for transient API failures (502, 503, etc.)
    const result = await withRetry(
      () => exchangeClient.order(orderRequest),
      "placeTakeProfit"
    );

    // Log full response for debugging
    console.log(`[placeTakeProfit] Full API response:`, JSON.stringify(result, null, 2));

    // Extract order ID - check for various status types
    const status = result?.response?.data?.statuses?.[0];
    let txHash = "pending";

    if (status) {
      if ("error" in status) {
        console.error(`[placeTakeProfit] Order error:`, status.error);
        throw new Error(`Take profit order failed: ${status.error}`);
      } else if ("filled" in status) {
        txHash = `tp_filled_${status.filled.oid}`;
      } else if ("resting" in status) {
        txHash = `tp_resting_${status.resting.oid}`;
      } else {
        console.log(`[placeTakeProfit] Unknown status type:`, status);
      }
    } else {
      console.error(`[placeTakeProfit] No status in response — order may not have been placed`);
      console.error(`[placeTakeProfit] Full result keys:`, Object.keys(result || {}));
      throw new Error(`Take profit order returned no status — API response missing statuses`);
    }

    console.log(`[placeTakeProfit] Successfully placed take-profit order: ${txHash}`);

    return {
      success: true,
      txHash,
    };
  } catch (error) {
    console.error(`[placeTakeProfit] Error:`, error);
    throw new Error(`Failed to place take-profit: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Close a position by placing a reduce-only order in the opposite direction
 * Uses aggressive slippage (3%) to ensure immediate fill at market price
 */
export async function closePosition(
  params: ClosePositionParams
): Promise<{ success: boolean; txHash: string }> {
  const { privateKey, symbol, size, price, isBuy, testnet } = params;

  try {
    // Add 3% slippage to ensure the order fills immediately in volatile markets
    // For buying (closing a SHORT): price higher than market
    // For selling (closing a LONG): price lower than market
    const slippagePct = 0.03; // 3% slippage - aggressive to guarantee fill
    const priceWithSlippage = isBuy
      ? price * (1 + slippagePct) // Buy higher to guarantee fill
      : price * (1 - slippagePct); // Sell lower to guarantee fill

    console.log(`[closePosition] Closing ${symbol} position:`, {
      side: isBuy ? "BUY (closing SHORT)" : "SELL (closing LONG)",
      size,
      marketPrice: price,
      priceWithSlippage,
      slippage: `${slippagePct * 100}%`,
    });

    const result = await placeOrder({
      privateKey,
      symbol,
      isBuy, // Opposite of position side
      size,
      price: priceWithSlippage,
      testnet,
      reduceOnly: true, // Important: this ensures we only close, not open a reverse position
      timeInForce: "Gtc", // Good-Till-Cancel: keep trying until filled (safer for closes)
    });

    console.log(`[closePosition] Close order result:`, result);

    return {
      success: result.success,
      txHash: result.txHash,
    };
  } catch (error) {
    console.error("Error closing position on Hyperliquid:", error);
    throw new Error(`Failed to close position: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get current market price for a symbol
 */
export async function getMarketPrice(
  symbol: string,
  testnet: boolean
): Promise<number> {
  return withRetry(async () => {
    const infoClient = createInfoClient(testnet);
    const allMids = await infoClient.allMids();

    const price = allMids[symbol];
    if (!price) {
      throw new Error(`No price found for symbol: ${symbol}`);
    }

    return parseFloat(price);
  }, `getMarketPrice(${symbol})`);
}

/**
 * Get user's current positions
 */
export async function getUserPositions(
  address: string,
  testnet: boolean
): Promise<any> {
  try {
    return await withRetry(async () => {
      const infoClient = createInfoClient(testnet);
      const state = await infoClient.clearinghouseState({ user: address });
      return state.assetPositions || [];
    }, "getUserPositions");
  } catch (error) {
    console.error("Error fetching user positions:", error);
    throw new Error(`Failed to fetch user positions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get user's open orders (pending/resting orders)
 */
export async function getUserOpenOrders(
  address: string,
  testnet: boolean
): Promise<any[]> {
  try {
    return await withRetry(async () => {
      const infoClient = createInfoClient(testnet);
      const openOrders = await infoClient.openOrders({ user: address });
      console.log(`[getUserOpenOrders] Found ${openOrders.length} open orders for ${address}`);
      return openOrders;
    }, "getUserOpenOrders");
  } catch (error) {
    console.error("Error fetching user open orders:", error);
    throw new Error(`Failed to fetch user open orders: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get user's frontend open orders (includes trigger orders like TP/SL).
 * Unlike `openOrders`, this includes: orderType, isTrigger, triggerPx, isPositionTpsl.
 */
export async function getFrontendOpenOrders(
  address: string,
  testnet: boolean
): Promise<any[]> {
  try {
    return await withRetry(async () => {
      const infoClient = createInfoClient(testnet);
      const orders = await infoClient.frontendOpenOrders({ user: address });
      console.log(`[getFrontendOpenOrders] Found ${orders.length} orders (including trigger orders)`);
      return orders;
    }, "getFrontendOpenOrders");
  } catch (error) {
    console.error("Error fetching frontend open orders:", error);
    throw new Error(`Failed to fetch frontend open orders: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify that TP/SL trigger orders exist on the exchange for a given symbol.
 * Returns the count and details of trigger orders found.
 */
export async function verifyTpSlOrders(
  address: string,
  symbol: string,
  testnet: boolean
): Promise<{ hasSl: boolean; hasTp: boolean; orders: any[] }> {
  try {
    const allOrders = await getFrontendOpenOrders(address, testnet);

    // Filter to trigger orders for this symbol
    const triggerOrders = allOrders.filter((o: any) =>
      o.coin === symbol && o.isTrigger === true
    );

    const hasSl = triggerOrders.some((o: any) =>
      o.orderType === "Stop Market" || o.orderType === "Stop Limit"
    );
    const hasTp = triggerOrders.some((o: any) =>
      o.orderType === "Take Profit Market" || o.orderType === "Take Profit Limit"
    );

    console.log(`[verifyTpSlOrders] ${symbol}: SL=${hasSl}, TP=${hasTp}, trigger orders=${triggerOrders.length}`);
    for (const o of triggerOrders) {
      console.log(`  - ${o.orderType} | side=${o.side} | triggerPx=${o.triggerPx} | sz=${o.sz}`);
    }

    return { hasSl, hasTp, orders: triggerOrders };
  } catch (error) {
    console.error(`[verifyTpSlOrders] Error verifying TP/SL for ${symbol}:`, error);
    return { hasSl: false, hasTp: false, orders: [] };
  }
}

/**
 * Cancel all open orders for a specific symbol
 * This is needed before closing a position if there are TP/SL orders
 */
export async function cancelAllOrdersForSymbol(
  privateKey: string,
  address: string,
  symbol: string,
  testnet: boolean
): Promise<{ success: boolean; cancelledCount: number }> {
  try {
    // Get all open orders
    const openOrders = await getUserOpenOrders(address, testnet);

    // Filter orders for this symbol
    const ordersToCancel = openOrders.filter((order: any) => order.coin === symbol);

    if (ordersToCancel.length === 0) {
      console.log(`[cancelAllOrdersForSymbol] No open orders for ${symbol}`);
      return { success: true, cancelledCount: 0 };
    }

    console.log(`[cancelAllOrdersForSymbol] Found ${ordersToCancel.length} orders to cancel for ${symbol}`);

    // Get asset info for the asset ID
    const assetInfo = await getAssetInfo(symbol, testnet);
    const exchangeClient = createExchangeClient(privateKey, testnet);

    // Cancel each order
    const cancels = ordersToCancel.map((order: any) => ({
      a: assetInfo.assetId,
      o: order.oid,
    }));

    console.log(`[cancelAllOrdersForSymbol] Cancelling orders:`, cancels);

    const result = await exchangeClient.cancel({ cancels });

    console.log(`[cancelAllOrdersForSymbol] Cancel result:`, JSON.stringify(result, null, 2));

    return { success: true, cancelledCount: ordersToCancel.length };
  } catch (error) {
    console.error("Error cancelling orders:", error);
    throw new Error(`Failed to cancel orders: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * NUCLEAR CLOSE: Cancel all orders for a symbol, then close the position
 * Use this when normal close doesn't work due to TP/SL orders blocking
 */
export async function nuclearClosePosition(
  privateKey: string,
  address: string,
  symbol: string,
  testnet: boolean
): Promise<{ success: boolean; txHash: string; cancelledOrders: number }> {
  try {
    console.log(`[nuclearClose] Starting nuclear close for ${symbol}`);

    // Step 1: Cancel ALL open orders for this symbol
    const cancelResult = await cancelAllOrdersForSymbol(privateKey, address, symbol, testnet);
    console.log(`[nuclearClose] Cancelled ${cancelResult.cancelledCount} orders`);

    // Small delay to let cancellations process
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 2: Get the position details
    const positions = await getUserPositions(address, testnet);
    const position = positions.find((p: any) => {
      const coin = p.position?.coin || p.coin;
      return coin === symbol;
    });

    if (!position) {
      return {
        success: true,
        txHash: "no_position",
        cancelledOrders: cancelResult.cancelledCount
      };
    }

    const pos = position.position || position;
    const szi = parseFloat(pos.szi || "0");
    const size = Math.abs(szi);
    const isLong = szi > 0;

    if (size === 0) {
      return {
        success: true,
        txHash: "zero_size",
        cancelledOrders: cancelResult.cancelledCount
      };
    }

    console.log(`[nuclearClose] Position found: ${isLong ? "LONG" : "SHORT"} ${size} ${symbol}`);

    // Step 3: Get current price
    const currentPrice = await getMarketPrice(symbol, testnet);

    // Step 4: Close with aggressive slippage
    const closeResult = await closePosition({
      privateKey,
      symbol,
      size,
      price: currentPrice,
      isBuy: !isLong,
      testnet,
    });

    console.log(`[nuclearClose] Close result:`, closeResult);

    return {
      success: closeResult.success,
      txHash: closeResult.txHash,
      cancelledOrders: cancelResult.cancelledCount,
    };
  } catch (error) {
    console.error("[nuclearClose] Error:", error);
    throw new Error(`Nuclear close failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
