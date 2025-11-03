/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_agents_tradingAgent from "../ai/agents/tradingAgent.js";
import type * as ai_chains_tradingChain from "../ai/chains/tradingChain.js";
import type * as ai_models_openrouter from "../ai/models/openrouter.js";
import type * as ai_models_zhipuai from "../ai/models/zhipuai.js";
import type * as ai_parsers_schemas from "../ai/parsers/schemas.js";
import type * as ai_parsers_tradeDecision from "../ai/parsers/tradeDecision.js";
import type * as ai_prompts_system from "../ai/prompts/system.js";
import type * as crons from "../crons.js";
import type * as hyperliquid_client from "../hyperliquid/client.js";
import type * as mutations from "../mutations.js";
import type * as queries from "../queries.js";
import type * as trading_tradingLoop from "../trading/tradingLoop.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "ai/agents/tradingAgent": typeof ai_agents_tradingAgent;
  "ai/chains/tradingChain": typeof ai_chains_tradingChain;
  "ai/models/openrouter": typeof ai_models_openrouter;
  "ai/models/zhipuai": typeof ai_models_zhipuai;
  "ai/parsers/schemas": typeof ai_parsers_schemas;
  "ai/parsers/tradeDecision": typeof ai_parsers_tradeDecision;
  "ai/prompts/system": typeof ai_prompts_system;
  crons: typeof crons;
  "hyperliquid/client": typeof hyperliquid_client;
  mutations: typeof mutations;
  queries: typeof queries;
  "trading/tradingLoop": typeof trading_tradingLoop;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};
