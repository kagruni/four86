"use node";

import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

// Symbol to Hyperliquid asset ID mapping
const SYMBOL_TO_ASSET_ID: Record<string, number> = {
  BTC: 0,
  ETH: 1,
  SOL: 2,
  BNB: 3,
  DOGE: 4,
  XRP: 5,
};

interface PlaceOrderParams {
  privateKey: string;
  symbol: string;
  isBuy: boolean;
  size: number;
  price: number;
  testnet: boolean;
  reduceOnly?: boolean;
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
 * Get asset ID from symbol
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
  _testnet: boolean
): hl.ExchangeClient {
  const wallet = createWallet(privateKey);
  // Note: The SDK handles testnet/mainnet URLs internally
  const transport = new hl.HttpTransport();

  return new hl.ExchangeClient({
    wallet,
    transport,
  });
}

/**
 * Create InfoClient instance for market data
 */
export function createInfoClient(_testnet: boolean): hl.InfoClient {
  // Note: The SDK handles testnet/mainnet URLs internally
  const transport = new hl.HttpTransport();

  return new hl.InfoClient({
    transport,
  });
}

/**
 * Place a limit order on Hyperliquid
 */
export async function placeOrder(
  params: PlaceOrderParams
): Promise<{ success: boolean; txHash: string; price: number }> {
  const { privateKey, symbol, isBuy, size, price, testnet, reduceOnly = false } = params;

  try {
    const assetId = getAssetId(symbol);
    const exchangeClient = createExchangeClient(privateKey, testnet);

    // Place the order
    const result = await exchangeClient.order({
      orders: [
        {
          a: assetId, // Asset ID
          b: isBuy, // true = buy/long, false = sell/short
          p: price.toString(), // Limit price as string
          s: size.toString(), // Size as string
          r: reduceOnly, // Reduce-only flag
          t: {
            limit: {
              tif: "Gtc", // Good-till-cancel
            },
          },
        },
      ],
      grouping: "na", // Not using order grouping
    });

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
