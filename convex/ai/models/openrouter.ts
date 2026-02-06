import { ChatOpenAI } from "@langchain/openai";

// Models that support reasoning/thinking mode
const REASONING_MODELS = [
  "deepseek/deepseek-chat-v3.1",
  "deepseek/deepseek-r1",
  "deepseek/deepseek-v3.2-speciale",
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

  // Override invoke to add detailed logging
  async invoke(input: any, options?: any): Promise<any> {
    console.log(`[OpenRouter] Invoking model with input length: ${JSON.stringify(input).length} chars`);
    const startTime = Date.now();

    try {
      const result = await super.invoke(input, options);
      const duration = Date.now() - startTime;
      console.log(`[OpenRouter] Response received in ${duration}ms, content length: ${result?.content?.length || 0} chars`);

      if (!result?.content || result.content.length === 0) {
        console.error(`[OpenRouter] WARNING: Empty content received from model`);
        console.error(`[OpenRouter] Full result:`, JSON.stringify(result, null, 2).slice(0, 500));
      }

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[OpenRouter] API call failed after ${duration}ms:`, error?.message || error);
      console.error(`[OpenRouter] Error details:`, JSON.stringify(error, null, 2).slice(0, 1000));
      throw error;
    }
  }
}
