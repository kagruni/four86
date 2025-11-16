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

  // Fetch fresh metadata
  console.log(`[getAssetMetadata] Fetching metadata for ${testnet ? "testnet" : "mainnet"}...`);
  const infoClient = createInfoClient(testnet);
  const [meta, ctx] = await infoClient.metaAndAssetCtxs();

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
    const formattedPrice = formatPrice(price.toString(), szDecimals, false);
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
      grouping: "na", // Not using order grouping
    };

    console.log(`[placeOrder] Order request object:`, JSON.stringify(orderRequest, null, 2));

    // Place the order
    const result = await exchangeClient.order(orderRequest);

    // Extract order ID from response
    const status = result?.response?.data?.statuses?.[0];
    let txHash = "pending";

    if (status) {
      if ("filled" in status) {
        txHash = `filled_${status.filled.oid}`;
      } else if ("resting" in status) {
        txHash = `resting_${status.resting.oid}`;
      }
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

    // Format trigger price and size
    const formattedTriggerPrice = formatPrice(triggerPrice.toString(), szDecimals, false);
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
              tpsl: "sl", // Stop loss
              triggerPx: formattedTriggerPrice,
            },
          },
        },
      ],
      grouping: "na",
    };

    console.log(`[placeStopLoss] Order request:`, JSON.stringify(orderRequest, null, 2));

    const result = await exchangeClient.order(orderRequest);

    // Extract order ID
    const status = result?.response?.data?.statuses?.[0];
    let txHash = "pending";

    if (status) {
      if ("filled" in status) {
        txHash = `sl_filled_${status.filled.oid}`;
      } else if ("resting" in status) {
        txHash = `sl_resting_${status.resting.oid}`;
      }
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

    // Format trigger price and size
    const formattedTriggerPrice = formatPrice(triggerPrice.toString(), szDecimals, false);
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
              tpsl: "tp", // Take profit
              triggerPx: formattedTriggerPrice,
            },
          },
        },
      ],
      grouping: "na",
    };

    console.log(`[placeTakeProfit] Order request:`, JSON.stringify(orderRequest, null, 2));

    const result = await exchangeClient.order(orderRequest);

    // Extract order ID
    const status = result?.response?.data?.statuses?.[0];
    let txHash = "pending";

    if (status) {
      if ("filled" in status) {
        txHash = `tp_filled_${status.filled.oid}`;
      } else if ("resting" in status) {
        txHash = `tp_resting_${status.resting.oid}`;
      }
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
 */
export async function closePosition(
  params: ClosePositionParams
): Promise<{ success: boolean; txHash: string }> {
  const { privateKey, symbol, size, price, isBuy, testnet } = params;

  try {
    const result = await placeOrder({
      privateKey,
      symbol,
      isBuy, // Opposite of position side
      size,
      price,
      testnet,
      reduceOnly: true, // Important: this ensures we only close, not open a reverse position
      timeInForce: "Ioc", // Immediate-Or-Cancel: execute immediately at market or cancel
    });

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
  try {
    const infoClient = createInfoClient(testnet);
    const allMids = await infoClient.allMids();

    const price = allMids[symbol];
    if (!price) {
      throw new Error(`No price found for symbol: ${symbol}`);
    }

    return parseFloat(price);
  } catch (error) {
    console.error("Error fetching market price:", error);
    throw new Error(`Failed to fetch market price: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get user's current positions
 */
export async function getUserPositions(
  address: string,
  testnet: boolean
): Promise<any> {
  try {
    const infoClient = createInfoClient(testnet);
    const state = await infoClient.clearinghouseState({ user: address });

    return state.assetPositions || [];
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
    const infoClient = createInfoClient(testnet);
    const openOrders = await infoClient.openOrders({ user: address });

    console.log(`[getUserOpenOrders] Found ${openOrders.length} open orders for ${address}`);
    return openOrders;
  } catch (error) {
    console.error("Error fetching user open orders:", error);
    throw new Error(`Failed to fetch user open orders: ${error instanceof Error ? error.message : String(error)}`);
  }
}
