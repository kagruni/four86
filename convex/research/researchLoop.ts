"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Research Loop — Scheduled action that fetches news and produces sentiment analysis.
 * Runs every 12 hours via cron.
 */

export const runResearchCycle = internalAction({
  handler: async (ctx) => {
    console.log("[RESEARCH] Starting research cycle...");
    const startTime = Date.now();

    try {
      // 1. Get all active bots (deduplicate by userId)
      const activeBots = await ctx.runQuery(internal.queries.getActiveBots);
      const userIds = [...new Set(activeBots.map((b: any) => b.userId))];

      if (userIds.length === 0) {
        console.log("[RESEARCH] No active bots, skipping research cycle");
        return;
      }

      // 2. Get credentials for first active user (they all share the same market)
      // We need API keys for CryptoPanic and OpenRouter
      const firstBot = activeBots[0];
      const credentials = await ctx.runQuery(
        internal.queries.getFullUserCredentials,
        {
          userId: firstBot.userId,
        }
      );

      if (!credentials?.openrouterApiKey) {
        console.log("[RESEARCH] No OpenRouter API key available, skipping");
        return;
      }

      const coins = firstBot.symbols || [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "DOGE",
        "XRP",
      ];

      // 3. Fetch all data sources in parallel
      const [fearGreedData, cryptoCompareNews] = await Promise.all([
        ctx.runAction(internal.research.newsApis.fetchFearGreedIndex, {}),
        ctx.runAction(internal.research.newsApis.fetchCryptoCompareNews, {
          coins,
        }),
      ]);

      // CryptoPanic requires API key - check environment variable
      let cryptoPanicNews = null;
      const cryptoPanicApiKey = process.env.CRYPTOPANIC_API_KEY;
      if (cryptoPanicApiKey) {
        cryptoPanicNews = await ctx.runAction(
          internal.research.newsApis.fetchCryptoPanicNews,
          {
            apiKey: cryptoPanicApiKey,
            coins,
          }
        );
      }

      console.log("[RESEARCH] Data fetched:", {
        fearGreed: fearGreedData
          ? `${fearGreedData.value} (${fearGreedData.label})`
          : "failed",
        cryptoPanic: cryptoPanicNews
          ? `${cryptoPanicNews.length} articles`
          : "skipped/failed",
        cryptoCompare: cryptoCompareNews
          ? `${cryptoCompareNews.length} articles`
          : "failed",
      });

      // 4. Analyze sentiment with LLM
      const analysis = await ctx.runAction(
        internal.research.sentimentAnalyzer.analyzeSentiment,
        {
          fearGreedData,
          cryptoPanicNews,
          cryptoCompareNews,
          coins,
          openrouterApiKey: credentials.openrouterApiKey,
        }
      );

      // 5. Store results for each active user
      const sources: string[] = [];
      if (fearGreedData) sources.push("alternative.me/fng");
      if (cryptoPanicNews) sources.push("cryptopanic.com");
      if (cryptoCompareNews) sources.push("cryptocompare.com");

      for (const userId of userIds) {
        await ctx.runMutation(
          internal.research.researchMutations.saveMarketResearch,
          {
            userId: userId as string,
            fearGreedIndex: fearGreedData?.value ?? 50,
            fearGreedLabel: fearGreedData?.label ?? "Neutral",
            overallSentiment: analysis.overall_sentiment,
            sentimentScore: analysis.sentiment_score,
            perCoinSentiment: analysis.per_coin_sentiment,
            keyEvents: analysis.key_events,
            marketNarrative: analysis.market_narrative,
            recommendedBias: analysis.recommended_bias,
            rawNewsData: { cryptoPanicNews, cryptoCompareNews },
            aiAnalysis: analysis,
            sources,
            processingTimeMs: Date.now() - startTime,
          }
        );
      }

      console.log(
        `[RESEARCH] Research cycle complete in ${Date.now() - startTime}ms`
      );
      console.log(
        `[RESEARCH] Sentiment: ${analysis.overall_sentiment} (${analysis.sentiment_score}), Bias: ${analysis.recommended_bias}`
      );
    } catch (error) {
      console.error("[RESEARCH] Research cycle failed:", error);
    }
  },
});
