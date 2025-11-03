import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage, AIMessage } from "@langchain/core/messages";
import { ChatResult } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

export interface ZhipuAIInput {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class ZhipuAI extends BaseChatModel {
  apiKey: string;
  model: string = "glm-4-plus";
  temperature: number = 0.7;
  maxTokens: number = 2000;

  constructor(fields: ZhipuAIInput) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.model = fields.model ?? this.model;
    this.temperature = fields.temperature ?? this.temperature;
    this.maxTokens = fields.maxTokens ?? this.maxTokens;
  }

  _llmType(): string {
    return "zhipuai";
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    // Convert LangChain messages to ZhipuAI format
    const formattedMessages = messages.map((msg) => ({
      role: msg._getType() === "human" ? "user" :
            msg._getType() === "system" ? "system" : "assistant",
      content: msg.content as string,
    }));

    // Call ZhipuAI API
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: formattedMessages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`ZhipuAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content;

    return {
      generations: [
        {
          text,
          message: new AIMessage(text),
        },
      ],
    };
  }
}
