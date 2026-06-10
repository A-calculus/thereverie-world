import { keccak256, toBytes } from "viem";
import { ALLOWED_CLIMATE_STATES, ALLOWED_CONFLICT_OUTCOMES, FIXED_PROMPTS } from "./prompts.js";
import type { WorldStyle } from "../types.js";

export type ReverieSdkAgentId = "chronicle" | "zoneClimate" | "factionMorale" | "conflict";

export interface ReverieSdkAgentDefinition {
  id: ReverieSdkAgentId;
  className: "ChronicleAgent" | "ZoneClimateAgent" | "FactionMoraleAgent" | "ConflictResolutionAgent";
  name: string;
  primitive: "native_llm" | "native_json_api";
  description: string;
  systemPrompt: string;
  method: "invoke";
  defaultInput: Record<string, string | boolean>;
  editable: string[];
  allowedValues?: readonly string[];
  estimate: {
    depositRequired: string;
    agentType: string;
    note: string;
  };
}

export const REVERIE_SDK_AGENT_DEFINITIONS: readonly ReverieSdkAgentDefinition[] = [
  {
    id: "chronicle",
    className: "ChronicleAgent",
    name: "Chronicle Agent",
    primitive: "native_llm",
    description: "Turns raw events into concise narrative history entries.",
    systemPrompt: FIXED_PROMPTS.chronicle,
    method: "invoke",
    editable: ["event", "style", "consensus", "persistOnChain"],
    defaultInput: {
      event: "A sudden mist covered the northern frontier and slowed merchant travel.",
      style: "epic",
      persistOnChain: false,
    },
    estimate: {
      depositRequired: "0.24+ STT",
      agentType: "llm",
      note: "Lane A LLM inference; optional world chronicle write",
    },
  },
  {
    id: "zoneClimate",
    className: "ZoneClimateAgent",
    name: "Zone Climate Agent",
    primitive: "native_json_api",
    description: "Maps Open-Meteo data into zone weather and danger changes.",
    systemPrompt: FIXED_PROMPTS.zoneClimate,
    method: "invoke",
    editable: ["zoneId", "city", "latitude", "longitude", "style", "consensus", "persistOnChain"],
    defaultInput: {
      zoneName: "Northern Frontier",
      zoneId: createDeterministicZoneId("demo-world", "Northern Frontier"),
      city: "Lagos",
      latitude: "6.5",
      longitude: "3.4",
      style: "epic",
      persistOnChain: false,
    },
    allowedValues: ALLOWED_CLIMATE_STATES,
    estimate: {
      depositRequired: "0.36+ STT",
      agentType: "json_api + llm",
      note: "Open-Meteo JSON consensus feeds the final climate LLM step",
    },
  },
  {
    id: "conflict",
    className: "ConflictResolutionAgent",
    name: "Conflict Resolution",
    primitive: "native_llm",
    description: "Resolves faction disputes from current state and recent events.",
    systemPrompt: FIXED_PROMPTS.conflict,
    method: "invoke",
    editable: ["zoneId", "factionA", "factionB", "context", "style", "consensus", "persistOnChain"],
    defaultInput: {
      zoneName: "Northern Frontier",
      zoneId: createDeterministicZoneId("demo-world", "Northern Frontier"),
      factionA: "Wardens",
      factionB: "Ember Court",
      context: "Both factions claim the same bridge after a storm destroyed nearby routes.",
      style: "dark_fantasy",
      persistOnChain: false,
    },
    allowedValues: ALLOWED_CONFLICT_OUTCOMES,
    estimate: {
      depositRequired: "0.24+ STT",
      agentType: "llm",
      note: "Reads zone state from the world, then writes an optional conflict outcome",
    },
  },
  {
    id: "factionMorale",
    className: "FactionMoraleAgent",
    name: "Faction Morale Agent",
    primitive: "native_json_api",
    description: "Turns market movement and faction context into morale and economy narrative updates.",
    systemPrompt: FIXED_PROMPTS.factionMorale,
    method: "invoke",
    editable: ["factionId", "pair", "currentMorale", "recentActions", "economyState", "objective", "style", "consensus", "persistOnChain"],
    defaultInput: {
      factionId: "merchants-guild",
      pair: "ETH/USDT",
      currentMorale: "62",
      recentActions: "The faction funded caravan repairs but lost two trade routes to a storm.",
      economyState: "Market volatility is rising while local supply routes are constrained.",
      objective: "Preserve trade confidence and avoid panic among allied settlements.",
      style: "cyberpunk",
      persistOnChain: false,
    },
    estimate: {
      depositRequired: "0.48+ STT",
      agentType: "json_api + json_api + llm",
      note: "Price and 24h movement consensus are passed into the final morale LLM step",
    },
  },
] as const;

export const REVERIE_WORLD_STYLES: readonly WorldStyle[] = [
  "epic",
  "noir",
  "mythological",
  "cyberpunk",
  "dark_fantasy",
  "financial",
  "governance",
  "social",
  "scientific",
  "legal",
  "supply_chain",
  "predictive",
  "minimal",
] as const;

export function getReverieSdkAgentDefinition(id: string): ReverieSdkAgentDefinition | undefined {
  return REVERIE_SDK_AGENT_DEFINITIONS.find((agent) => agent.id === id);
}

export function createDeterministicZoneId(worldKey: string, zoneName: string): `0x${string}` {
  const normalizedWorld = worldKey.trim().toLowerCase() || "reverie-world";
  const normalizedZone = zoneName.trim().toLowerCase().replace(/\s+/g, "-") || "zone";
  return keccak256(toBytes(`reverie:zone:${normalizedWorld}:${normalizedZone}`));
}
