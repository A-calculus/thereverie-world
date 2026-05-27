export { SomniaAgentKit } from "./SomniaAgentKit.js";
export type {
  LLMResult,
  LLMStringResult,
  LLMNumberResult,
  LLMToolsChatResult,
  JsonApiResult,
  WebParseResult,
  WebParseStringResult,
  WebParseNumberResult,
} from "./SomniaAgentKit.js";
export {
  SomniaError,
  SomniaValidationError,
  SomniaTimeoutError,
  SomniaAgentFailedError,
  SomniaWebSocketError,
  SomniaWalletError,
  SomniaInsufficientFundsError,
} from "./errors.js";
export {
  TESTNET_ADDRESSES,
  AGENT_IDS,
  PRACTICAL_DEPOSITS,
  getPlatformAddress,
  getReceiptUrl,
  getRegistryAddress,
  getDefaultSubcommitteeSize,
  getDefaultConfidenceThreshold,
} from "./contracts/addresses.js";
export { calculateDeposit } from "./utils/deposit.js";
export type { SdkConfig, LLMOptions, JsonApiOptions, WebParseOptions } from "./validation/schemas.js";
