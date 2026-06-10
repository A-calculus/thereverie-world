/**
 * Browser-focused SDK entry for wallet-signed native agent execution.
 * This avoids importing world/reactivity modules in frontend bundles that only
 * need Somnia native agents.
 */

export {
  WorldFrameSDK,
} from "./WorldFrameSDK.js";
export {
  WorldInstance,
} from "./WorldInstance.js";
export {
  SomniaAgentKit,
  calculateDeposit,
  getReceiptUrl,
  TESTNET_ADDRESSES,
  AGENT_IDS as AGENTKIT_AGENT_IDS,
  PRACTICAL_DEPOSITS,
} from "./agentkit/index.js";
export {
  NativeAgents,
  NativeLlmAgent,
  NativeJsonApiAgent,
  NativeWebParseAgent,
} from "./native/index.js";
export {
  REVERIE_SDK_AGENT_DEFINITIONS,
  REVERIE_WORLD_STYLES,
  createDeterministicZoneId,
  getReverieSdkAgentDefinition,
} from "./agents/metadata.js";
export { compileWorldManifest, MANIFEST_STEP_KIND } from "./manifest.js";
export { somniaTestnet, AGENT_IDS, AGENT_COSTS, PLATFORM_ADDRESSES } from "./constants.js";
export {
  SOMNIA_AGENT_EXPLORER_URL,
  SOMNIA_EVM_EXPLORER_URL,
  getAddressUrl,
  getAgentReceiptUrl,
  getTransactionUrl,
} from "./explorer.js";
export {
  decodeWorldRuntimeLogs,
  decodeReactivitySubscriptionLogs,
  formatStt,
  verifyReceiptSummary,
  worldExplorerLinks,
} from "./runtime-events.js";
export type {
  DecodedWorldRuntimeEvent,
  DecodedReactivitySubscriptionEvent,
  VerifiedTransaction,
  WorldRuntimeEventKind,
} from "./runtime-events.js";

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
export type {
  ReverieSdkAgentDefinition,
  ReverieSdkAgentId,
} from "./agents/metadata.js";
export type {
  CompiledWorldManifest,
  WorldManifestFaction,
  WorldManifestRelationship,
  WorldManifestStep,
  WorldManifestTrigger,
  WorldManifestZone,
} from "./manifest.js";
