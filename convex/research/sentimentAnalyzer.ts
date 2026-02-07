"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

/**
 * Sentiment Analyzer
 * Uses OpenRouter LLM to analyze aggregated news data and produce structured sentiment.
 */

export const analyzeSentiment = internalAction({
  args: {
    fearGreedData: v.any(),
    cryptoPanicNews: v.any(),
    cryptoCompareNews: v.any(),
    coins: v.array(v.string()),
    openrouterApiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Build the prompt with all available data
    let newsContext = "";

    if (args.fearGreedData) {
      newsContext += `\n## Fear & Greed Index\nValue: ${args.fearGreedData.value}/100 (${args.fearGreedData.label})\n`;
    }

    if (args.cryptoPanicNews) {
      newsContext += `\n## CryptoPanic Headlines (community-voted)\n`;
      for (const item of args.cryptoPanicNews) {
        const sentiment =
          item.votes.positive > item.votes.negative
            ? "+"
            : item.votes.negative > item.votes.positive
              ? "-"
              : "=";
        newsContext += `[${sentiment}] ${item.title} (${item.currencies.join(",")})\n`;
      }
    }

    if (args.cryptoCompareNews) {
      newsContext += `\n## CryptoCompare News\n`;
      for (const item of args.cryptoCompareNews) {
        newsContext += `- ${item.title} [${item.categories}]\n`;
      }
    }

    const systemPrompt = `You are a crypto market sentiment analyst. Analyze the following news data and produce a JSON sentiment report.

IMPORTANT: Respond ONLY with valid JSON, no markdown, no explanation.

The JSON must have this exact structure:
{
  "overall_sentiment": "very_bearish" | "bearish" | "neutral" | "bullish" | "very_bullish",
  "sentiment_score": <number from -1.0 to 1.0>,
  "key_events": [
    { "headline": "<string>", "impact": "high" | "medium" | "low", "asset": "<coin>", "sentiment": "bearish" | "neutral" | "bullish" }
  ],
  "per_coin_sentiment": {
    "<COIN>": { "sentiment": "bearish" | "neutral" | "bullish", "news_count": <number>, "key_headline": "<string>" }
  },
  "market_narrative": "<1-2 sentence summary>",
  "recommended_bias": "risk_off" | "neutral" | "risk_on"
}

Analyze for these coins: ${args.coins.join(", ")}`;

    try {
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${args.openrouterApiKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.0-flash-001",
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content:
                  newsContext ||
                  "No news data available. Provide a neutral assessment.",
              },
            ],
            temperature: 0.3,
            max_tokens: 1000,
          }),
        }
      );

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";

      // Extract JSON from response
      let jsonStr = content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const analysis = JSON.parse(jsonStr);
      const processingTimeMs = Date.now() - startTime;

      return {
        ...analysis,
        processingTimeMs,
      };
    } catch (error) {
      console.error("[SENTIMENT] Analysis failed:", error);
      return {
        overall_sentiment: "neutral",
        sentiment_score: 0,
        key_events: [],
        per_coin_sentiment: {},
        market_narrative: "Sentiment analysis unavailable",
        recommended_bias: "neutral",
        processingTimeMs: Date.now() - startTime,
      };
    }
  },
});
