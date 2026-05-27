/**
 * Shared TypeScript types for the @worldframe/sdk
 */

// ─── Signer / Provider Abstraction ───────────────────────────────────────────

export type NetworkId = "testnet";

/** Config for Node.js / private-key mode */
export interface PrivateKeyConfig {
  mode: "privateKey";
  privateKey: `0x${string}`;
  network: NetworkId;
}

/** Config for browser wallet mode (MetaMask / injected provider) */
export interface BrowserWalletConfig {
  mode: "browser";
  network: NetworkId;
}

export type SDKConfig = PrivateKeyConfig | BrowserWalletConfig;

// ─── World Types ──────────────────────────────────────────────────────────────

export type WorldStatus =
  | "DRAFT"
  | "DEPLOYED"
  | "FUNDED"
  | "RUNNING"
  | "PAUSED"
  | "REBUILDING";

export interface WorldRecord {
  worldAddress: `0x${string}`;
  name: string;
  template: string;
  status?: WorldStatus;
}

export interface Zone {
  id: `0x${string}`;
  name: string;
  dangerLevel: bigint;
  controllingFaction: string;
  climateState?: string;
}

// ─── World Events ─────────────────────────────────────────────────────────────

export type WorldEventType =
  | "agent_decision"
  | "chronicle_entry"
  | "zone_updated"
  | "faction_updated"
  | "trigger_fired"
  | "world_paused"
  | "world_funded";

export interface WorldEvent {
  type: WorldEventType;
  timestamp: number;
  description?: string;
  requestId?: bigint;
  triggerId?: `0x${string}`;
  data?: Record<string, unknown>;
}

// ─── Trigger Config ───────────────────────────────────────────────────────────

export type FeedType = "weather" | "token_price" | "nft_floor" | "custom";
/** All 7 agents exposed by @worldframe/sdk */
export type WorldframeAgentId =
  | "llm"
  | "jsonApi"
  | "webParse"
  | "chronicle"
  | "zone_climate"
  | "faction_morale"
  | "conflict_resolution";

export type AgentType =
  | "chronicle"
  | "zone_climate"
  | "faction_morale"
  | "conflict_resolution";

export type TriggerMode = "offchain" | "onchain";

export interface TriggerCondition {
  field?: string;
  operator: "in" | "lt" | "gt" | "eq";
  value?: number;
  values?: number[];
}
export type WorldStyle =
  | "epic"
  | "noir"
  | "mythological"
  | "cyberpunk"
  | "dark_fantasy";

export interface WeatherFeed {
  type: "weather";
  city: string;
}

export interface TokenPriceFeed {
  type: "token_price";
  pair: string; // e.g. "ETH/USDT"
}

export interface NftFloorFeed {
  type: "nft_floor";
  collectionSlug: string;
}

export interface CustomFeed {
  type: "custom";
  url: string;
  jsonPath: string;
}

export type DataFeed = WeatherFeed | TokenPriceFeed | NftFloorFeed | CustomFeed;

export interface TriggerConfig {
  triggerId?: `0x${string}`;
  feed: DataFeed;
  agent: AgentType;
  condition?: TriggerCondition;
  /** offchain = SDK WSS/poll (default); onchain = Reactivity precompile subscription */
  mode?: TriggerMode;
  pollIntervalSeconds?: number;
  cooldownSeconds?: number;
  zoneId?: `0x${string}`;
  factionId?: string;
  style?: WorldStyle;
}

// ─── Cost Estimate ────────────────────────────────────────────────────────────

export interface CostEstimate {
  depositRequired: string; // e.g. "0.24 STT"
  agentType: string;
  note: string;
}
