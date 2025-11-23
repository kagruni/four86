import { ChatOpenAI } from "@langchain/openai";

// Models that support reasoning/thinking mode
const REASONING_MODELS = [
  "deepseek/deepseek-chat-v3.1",
  "deepseek/deepseek-r1",
  "moonshotai/kimi-k2-thinking",
];

export class OpenRouterChat extends ChatOpenAI {
  constructor(fields: {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    enableReasoning?: boolean;
  }) {
    // Check if this model supports reasoning
    const supportsReasoning = REASONING_MODELS.some(m => fields.model.includes(m));
    const useReasoning = fields.enableReasoning !== false && supportsReasoning;

    // For trading decisions: low temperature for consistency
    const defaultTemp = 0.2; // Deterministic for trading
    // Reasoning models need more tokens for <think> tags output
    const defaultMaxTokens = supportsReasoning ? 8000 : 4000;

    super({
      openAIApiKey: fields.apiKey,
      modelName: fields.model,
      temperature: fields.temperature ?? defaultTemp,
      maxTokens: fields.maxTokens ?? defaultMaxTokens,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          "X-Title": "Four86 Trading Bot",
        },
      },
      // NOTE: Reasoning must be enabled via prompt, not API params
      // LangChain doesn't forward modelKwargs correctly to OpenRouter
    });

    console.log(`[OpenRouter] Model: ${fields.model}, temp: ${fields.temperature ?? defaultTemp}, tokens: ${fields.maxTokens ?? defaultMaxTokens}`);
    if (supportsReasoning) {
      console.log(`[OpenRouter] Note: ${fields.model} supports reasoning via <think> tags in output`);
    }
  }
}
