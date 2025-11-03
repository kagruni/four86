import { ChatOpenAI } from "@langchain/openai";

export class OpenRouterChat extends ChatOpenAI {
  constructor(fields: {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }) {
    super({
      openAIApiKey: fields.apiKey,
      modelName: fields.model,
      temperature: fields.temperature ?? 0.7,
      maxTokens: fields.maxTokens ?? 2000,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          "X-Title": "Four86 Trading Bot",
        },
      },
    });
  }
}
