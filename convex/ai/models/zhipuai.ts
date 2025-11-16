import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage, AIMessage } from "@langchain/core/messages";
import { ChatResult } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

export interface ZhipuAIInput {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string; // Allow custom base URL
  tools?: any[]; // Tool/function definitions
}

export class ZhipuAI extends BaseChatModel {
  apiKey: string;
  model: string = "glm-4.6"; // Default to glm-4.6
  temperature: number = 0.7;
  maxTokens: number = 2000;
  baseURL: string = "https://api.z.ai/api/paas/v4"; // Z.AI platform (OpenAI-compatible)
  tools?: any[]; // Tool definitions for function calling

  constructor(fields: ZhipuAIInput) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.model = fields.model ?? this.model;
    this.temperature = fields.temperature ?? this.temperature;
    this.maxTokens = fields.maxTokens ?? this.maxTokens;
    this.baseURL = fields.baseURL ?? this.baseURL;
    this.tools = fields.tools;
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

    // Retry logic for rate limits
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Build full API endpoint
        const apiEndpoint = `${this.baseURL}/chat/completions`;

        console.log(`[ZhipuAI] Calling API: ${apiEndpoint} with model: ${this.model}`);
        console.log(`[ZhipuAI] API Key present: ${this.apiKey ? 'Yes (length: ' + this.apiKey.length + ')' : 'No'}`);
        console.log(`[ZhipuAI] Request params:`, JSON.stringify({
          model: this.model,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          message_count: formattedMessages.length,
          tools_enabled: !!this.tools
        }));

        // Prepare request body
        const requestBody: any = {
          model: this.model,
          messages: formattedMessages,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        };

        // Add tools if provided (OpenAI-compatible function calling)
        if (this.tools && this.tools.length > 0) {
          requestBody.tools = this.tools;
          requestBody.tool_choice = "auto"; // Let model decide when to use tools
        }

        // Call ZhipuAI API
        const response = await fetch(apiEndpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        console.log(`[ZhipuAI] Response status: ${response.status} ${response.statusText}`);

        // Handle rate limit (429) with retry
        if (response.status === 429) {
          // Log the actual error body to see what ZhipuAI is saying
          const errorBody = await response.text();
          console.error(`[ZhipuAI] 429 Error Body:`, errorBody);

          const retryAfter = response.headers.get("Retry-After");
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;

          console.log(`ZhipuAI rate limit hit. Retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);

          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          } else {
            throw new Error(`ZhipuAI API error: Too Many Requests - ${errorBody}`);
          }
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[ZhipuAI] API Error Response:`, errorText);
          throw new Error(`ZhipuAI API error (${response.status}): ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
          throw new Error(`ZhipuAI API returned invalid response format: ${JSON.stringify(data)}`);
        }

        const message = data.choices[0].message;
        const toolCalls = message.tool_calls;

        console.log(`[ZhipuAI] Success! Generated ${data.usage?.total_tokens || 0} tokens`);
        console.log(`[ZhipuAI] Has tool_calls:`, !!toolCalls);

        // Handle tool calls (function calling)
        if (toolCalls && toolCalls.length > 0) {
          console.log(`[ZhipuAI] Tool calls:`, JSON.stringify(toolCalls));

          // Extract the first tool call (for trading decisions, we expect only one)
          const toolCall = toolCalls[0];
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[ZhipuAI] Function: ${functionName}`);
          console.log(`[ZhipuAI] Arguments:`, JSON.stringify(functionArgs, null, 2));

          // Return the function arguments as structured data
          // Convert tool call to text format for compatibility with LangChain parsers
          const text = JSON.stringify(functionArgs);

          return {
            generations: [
              {
                text,
                message: new AIMessage(text),
              },
            ],
          };
        }

        // Regular text response (no tool calls)
        const text = message.content || "";

        console.log(`[ZhipuAI] Response preview:`, text.substring(0, 500));

        return {
          generations: [
            {
              text,
              message: new AIMessage(text),
            },
          ],
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on non-rate-limit errors
        if (!lastError.message.includes("Too Many Requests") && !lastError.message.includes("429")) {
          throw lastError;
        }

        console.error(`ZhipuAI API error (attempt ${attempt + 1}/${maxRetries}):`, lastError.message);

        // Wait before retry with exponential backoff
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error("ZhipuAI API call failed after all retries");
  }
}
