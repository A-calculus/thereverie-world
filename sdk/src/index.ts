/**
 * @worldframe/sdk — Public API
 */

export { WorldFrameSDK } from "./WorldFrameSDK.js";
export { WorldInstance } from "./WorldInstance.js";

// ─── Somnia native agents (3) ─────────────────────────────────────────────────
export {
  NativeAgents,
  NativeLlmAgent,
  NativeJsonApiAgent,
  NativeWebParseAgent,
} from "./native/index.js";

// ─── REVERIE world agents (4) ─────────────────────────────────────────────────
export { ChronicleAgent } from "./agents/ChronicleAgent.js";
export { ZoneClimateAgent } from "./agents/ZoneClimateAgent.js";
export { FactionMoraleAgent } from "./agents/FactionMoraleAgent.js";
export { ConflictResolutionAgent } from "./agents/ConflictResolutionAgent.js";

export {
  SomniaAgentKit,
  calculateDeposit,
  getReceiptUrl,
  getRegistryAddress,
  TESTNET_ADDRESSES,
  AGENT_IDS as AGENTKIT_AGENT_IDS,
  PRACTICAL_DEPOSITS,
} from "./agentkit/index.js";
export type {
  LLMResult,
  LLMStringResult,
  LLMNumberResult,
  LLMToolsChatResult,
  JsonApiResult,
  WebParseResult,
  WebParseStringResult,
  WebParseNumberResult,
  SdkConfig as AgentKitConfig,
} from "./agentkit/index.js";
export {
  SomniaError,
  SomniaValidationError,
  SomniaTimeoutError,
  SomniaAgentFailedError,
  SomniaWebSocketError,
  SomniaWalletError,
  SomniaInsufficientFundsError,
} from "./agentkit/index.js";

export { somniaTestnet, AGENT_IDS, AGENT_COSTS, PLATFORM_ADDRESSES } from "./constants.js";
export { WORLD_INSTANCE_ABI, REGISTRY_ABI } from "./abis.js";
export { TriggerManager } from "./reactivity/TriggerManager.js";
export { subscribeReactivityEvents } from "./reactivity/ReactivityClient.js";
export type { ReactivitySubscribeParams } from "./reactivity/ReactivityClient.js";
export type { ExtendedTriggerConfig } from "./reactivity/TriggerManager.js";
export { FIXED_PROMPTS } from "./agents/prompts.js";
export type { InvokeOptions, ExecutionLane } from "./types/execution.js";

export type {
  SDKConfig,
  PrivateKeyConfig,
  BrowserWalletConfig,
  NetworkId,
  WorldStatus,
  WorldRecord,
  WorldEvent,
  WorldEventType,
  Zone,
  TriggerConfig,
  DataFeed,
  WeatherFeed,
  TokenPriceFeed,
  NftFloorFeed,
  CustomFeed,
  AgentType,
  WorldframeAgentId,
  FeedType,
  WorldStyle,
  TriggerMode,
  TriggerCondition,
  CostEstimate,
} from "./types.js";
