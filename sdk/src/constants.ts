// Somnia Testnet chain definition for viem
import { defineChain } from "viem";
import {
  AGENT_IDS as AGENTKIT_AGENT_IDS,
  PRACTICAL_DEPOSITS,
  TESTNET_ADDRESSES,
} from "./agentkit/contracts/addresses.js";

export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://api.infra.testnet.somnia.network"],
      webSocket: ["wss://api.infra.testnet.somnia.network/ws"],
    },
  },
  blockExplorers: {
    default: {
      name: "Somnia Explorer",
      url: "https://shannon-explorer.somnia.network",
    },
  },
});

// ─── Platform Contract Addresses ────────────────────────────────────────────

export const PLATFORM_ADDRESSES = {
  get testnet() {
    return {
      /** Primary platform — used by JSON API and Parse Website agents */
      primary: TESTNET_ADDRESSES.platformPrimary,
      /** Alternate platform — used by LLM Inference agent */
      llm: TESTNET_ADDRESSES.platformAlternate,
    };
  },
} as const;

// ─── Registered Agent IDs ────────────────────────────────────────────────────

export const AGENT_IDS = {
  get JSON_API(): bigint {
    return AGENTKIT_AGENT_IDS.jsonApi;
  },
  get LLM_INFERENCE(): bigint {
    return AGENTKIT_AGENT_IDS.llm;
  },
  get LLM_PARSE_WEBSITE(): bigint {
    return AGENTKIT_AGENT_IDS.webParse;
  },
} as const;

// ─── Deposit Costs (in STT, per agent call) ──────────────────────────────────

export const AGENT_COSTS = {
  get LLM_INFERENCE(): number {
    return Number(PRACTICAL_DEPOSITS.llm) / 1e18;
  },
  get LLM_PARSE_WEBSITE(): number {
    return Number(PRACTICAL_DEPOSITS.webParse) / 1e18;
  },
  get JSON_API(): number {
    return Number(PRACTICAL_DEPOSITS.jsonApi) / 1e18;
  },
} as const;
