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
import type * as ai_prompts_alphaArenaPrompt from "../ai/prompts/alphaArenaPrompt.js";
import type * as ai_prompts_compactSystem from "../ai/prompts/compactSystem.js";
import type * as ai_prompts_detailedSystem from "../ai/prompts/detailedSystem.js";
import type * as ai_prompts_promptHelpers from "../ai/prompts/promptHelpers.js";
import type * as ai_prompts_system from "../ai/prompts/system.js";
import type * as ai_tools_tradingTools from "../ai/tools/tradingTools.js";
import type * as crons from "../crons.js";
import type * as hyperliquid_candles from "../hyperliquid/candles.js";
import type * as hyperliquid_client from "../hyperliquid/client.js";
import type * as hyperliquid_detailedMarketData from "../hyperliquid/detailedMarketData.js";
import type * as hyperliquid_sdk from "../hyperliquid/sdk.js";
import type * as indicators_technicalIndicators from "../indicators/technicalIndicators.js";
import type * as migrations_removeStopLossEnabled from "../migrations/removeStopLossEnabled.js";
import type * as migrations_runMigration from "../migrations/runMigration.js";
import type * as mutations from "../mutations.js";
import type * as queries from "../queries.js";
import type * as signals_divergenceDetection from "../signals/divergenceDetection.js";
import type * as signals_entrySignals from "../signals/entrySignals.js";
import type * as signals_levelDetection from "../signals/levelDetection.js";
import type * as signals_riskAssessment from "../signals/riskAssessment.js";
import type * as signals_signalProcessor from "../signals/signalProcessor.js";
import type * as signals_trendAnalysis from "../signals/trendAnalysis.js";
import type * as signals_types from "../signals/types.js";
import type * as testing_diagnosticBots from "../testing/diagnosticBots.js";
import type * as testing_diagnosticPositions from "../testing/diagnosticPositions.js";
import type * as testing_manualPositionSync from "../testing/manualPositionSync.js";
import type * as testing_manualTrigger from "../testing/manualTrigger.js";
import type * as testing_recoverPositions from "../testing/recoverPositions.js";
import type * as trading_performanceMetrics from "../trading/performanceMetrics.js";
import type * as trading_positionSync from "../trading/positionSync.js";
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
  "ai/prompts/alphaArenaPrompt": typeof ai_prompts_alphaArenaPrompt;
  "ai/prompts/compactSystem": typeof ai_prompts_compactSystem;
  "ai/prompts/detailedSystem": typeof ai_prompts_detailedSystem;
  "ai/prompts/promptHelpers": typeof ai_prompts_promptHelpers;
  "ai/prompts/system": typeof ai_prompts_system;
  "ai/tools/tradingTools": typeof ai_tools_tradingTools;
  crons: typeof crons;
  "hyperliquid/candles": typeof hyperliquid_candles;
  "hyperliquid/client": typeof hyperliquid_client;
  "hyperliquid/detailedMarketData": typeof hyperliquid_detailedMarketData;
  "hyperliquid/sdk": typeof hyperliquid_sdk;
  "indicators/technicalIndicators": typeof indicators_technicalIndicators;
  "migrations/removeStopLossEnabled": typeof migrations_removeStopLossEnabled;
  "migrations/runMigration": typeof migrations_runMigration;
  mutations: typeof mutations;
  queries: typeof queries;
  "signals/divergenceDetection": typeof signals_divergenceDetection;
  "signals/entrySignals": typeof signals_entrySignals;
  "signals/levelDetection": typeof signals_levelDetection;
  "signals/riskAssessment": typeof signals_riskAssessment;
  "signals/signalProcessor": typeof signals_signalProcessor;
  "signals/trendAnalysis": typeof signals_trendAnalysis;
  "signals/types": typeof signals_types;
  "testing/diagnosticBots": typeof testing_diagnosticBots;
  "testing/diagnosticPositions": typeof testing_diagnosticPositions;
  "testing/manualPositionSync": typeof testing_manualPositionSync;
  "testing/manualTrigger": typeof testing_manualTrigger;
  "testing/recoverPositions": typeof testing_recoverPositions;
  "trading/performanceMetrics": typeof trading_performanceMetrics;
  "trading/positionSync": typeof trading_positionSync;
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
