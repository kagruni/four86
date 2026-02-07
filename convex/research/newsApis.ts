"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

/**
 * News API integrations for market sentiment analysis.
 * All functions handle errors independently and return null on failure.
 */

// Fear & Greed Index
export const fetchFearGreedIndex = internalAction({
  args: {},
  handler: async () => {
    try {
      const response = await fetch("https://api.alternative.me/fng/?limit=1");
      const data = await response.json();

      if (data.data && data.data[0]) {
        return {
          value: parseInt(data.data[0].value),
          label: data.data[0].value_classification,
          timestamp: parseInt(data.data[0].timestamp) * 1000,
        };
      }
      return null;
    } catch (error) {
      console.error("[NEWS API] Fear & Greed fetch failed:", error);
      return null;
    }
  },
});

// CryptoPanic News
export const fetchCryptoPanicNews = internalAction({
  args: {
    apiKey: v.string(),
    coins: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const currencies = args.coins.join(",");
      const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${args.apiKey}&currencies=${currencies}&filter=important&kind=news`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.results) {
        return data.results.slice(0, 20).map((item: any) => ({
          title: item.title,
          publishedAt: item.published_at,
          url: item.url,
          source: item.source?.title || "Unknown",
          currencies: item.currencies?.map((c: any) => c.code) || [],
          votes: {
            positive: item.votes?.positive || 0,
            negative: item.votes?.negative || 0,
            important: item.votes?.important || 0,
            liked: item.votes?.liked || 0,
          },
          kind: item.kind,
        }));
      }
      return null;
    } catch (error) {
      console.error("[NEWS API] CryptoPanic fetch failed:", error);
      return null;
    }
  },
});

// CryptoCompare News
export const fetchCryptoCompareNews = internalAction({
  args: {
    coins: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const categories = args.coins.join(",");
      const url = `https://min-api.cryptocompare.com/data/v2/news/?categories=${categories}&excludeCategories=Sponsored`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.Data) {
        return data.Data.slice(0, 15).map((item: any) => ({
          title: item.title,
          body: item.body?.substring(0, 300) || "",
          publishedAt: item.published_on * 1000,
          url: item.url,
          source: item.source,
          categories: item.categories,
          tags: item.tags,
        }));
      }
      return null;
    } catch (error) {
      console.error("[NEWS API] CryptoCompare fetch failed:", error);
      return null;
    }
  },
});
