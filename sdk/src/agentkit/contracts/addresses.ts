/**
 * Testnet addresses — env-first with documented fallbacks (Notes 10).
 */

const FALLBACK = {
  platformPrimary: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as `0x${string}`,
  platformAlternate: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as `0x${string}`,
  agentRegistry: "0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A" as `0x${string}`,
} as const;

const FALLBACK_AGENT_IDS = {
  llm: 12847293847561029384n,
  jsonApi: 13174292974160097713n,
  webParse: 12875401142070969085n,
} as const;

const FALLBACK_PER_AGENT_PRICES = {
  llm: 70000000000000000n,
  jsonApi: 30000000000000000n,
  webParse: 100000000000000000n,
} as const;

const FALLBACK_PRACTICAL_DEPOSITS = {
  llm: 240000000000000000n,
  jsonApi: 120000000000000000n,
  webParse: 330000000000000000n,
} as const;

function envVar(key: string, fallback: string): string {
  const env =
    typeof globalThis !== "undefined"
      ? (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env
      : undefined;
  return env?.[key] ?? fallback;
}

function envAddress(key: string, fallback: `0x${string}`): `0x${string}` {
  const v = envVar(key, fallback);
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`;
  return fallback;
}

function envBigInt(key: string, fallback: bigint): bigint {
  try {
    return BigInt(envVar(key, fallback.toString()));
  } catch {
    return fallback;
  }
}

export const TESTNET_ADDRESSES = {
  get platformPrimary(): `0x${string}` {
    return envAddress("SOMNIA_PLATFORM_PRIMARY", FALLBACK.platformPrimary);
  },
  get platformAlternate(): `0x${string}` {
    return envAddress("SOMNIA_PLATFORM_LLM", FALLBACK.platformAlternate);
  },
  get agentRegistry(): `0x${string}` {
    return envAddress("SOMNIA_AGENT_REGISTRY", FALLBACK.agentRegistry);
  },
} as const;

export const AGENT_IDS = {
  get llm(): bigint {
    return envBigInt("SOMNIA_AGENT_ID_LLM", FALLBACK_AGENT_IDS.llm);
  },
  get jsonApi(): bigint {
    return envBigInt("SOMNIA_AGENT_ID_JSON_API", FALLBACK_AGENT_IDS.jsonApi);
  },
  get webParse(): bigint {
    return envBigInt("SOMNIA_AGENT_ID_WEB_PARSE", FALLBACK_AGENT_IDS.webParse);
  },
} as const;

export const PRACTICAL_DEPOSITS = {
  get llm(): bigint {
    return envBigInt("SOMNIA_DEPOSIT_LLM", FALLBACK_PRACTICAL_DEPOSITS.llm);
  },
  get jsonApi(): bigint {
    return envBigInt("SOMNIA_DEPOSIT_JSON_API", FALLBACK_PRACTICAL_DEPOSITS.jsonApi);
  },
  get webParse(): bigint {
    return envBigInt("SOMNIA_DEPOSIT_WEB_PARSE", FALLBACK_PRACTICAL_DEPOSITS.webParse);
  },
} as const;

export const PER_AGENT_PRICES = {
  get llm(): bigint {
    return envBigInt("SOMNIA_RUNNER_PRICE_LLM", FALLBACK_PER_AGENT_PRICES.llm);
  },
  get jsonApi(): bigint {
    return envBigInt("SOMNIA_RUNNER_PRICE_JSON_API", FALLBACK_PER_AGENT_PRICES.jsonApi);
  },
  get webParse(): bigint {
    return envBigInt("SOMNIA_RUNNER_PRICE_WEB_PARSE", FALLBACK_PER_AGENT_PRICES.webParse);
  },
} as const;

export type AgentPlatformType = "llm" | "jsonApi" | "webParse";

export function getPlatformAddress(agentType: AgentPlatformType): `0x${string}` {
  switch (agentType) {
    case "llm":
      return TESTNET_ADDRESSES.platformAlternate;
    case "jsonApi":
    case "webParse":
      return TESTNET_ADDRESSES.platformPrimary;
  }
}

export function getCallbackReceiverAddress(
  agentType: AgentPlatformType
): `0x${string}` | undefined {
  if (agentType === "llm") {
    const v = envVar("CALLBACK_RECEIVER_LLM", "");
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`;
    return undefined;
  }
  const v = envVar("CALLBACK_RECEIVER_PRIMARY", "");
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`;
  return undefined;
}

export function getDefaultSubcommitteeSize(): bigint {
  return envBigInt("DEFAULT_SUBCOMMITTEE_SIZE", 3n);
}

export function getDefaultConfidenceThreshold(): number {
  return parseInt(envVar("CONFIDENCE_THRESHOLD_DEFAULT", "70"), 10);
}

/** Extra STT padding on every request — excess is refunded (Notes 11). */
export function getDefaultDepositBuffer(): bigint {
  return envBigInt("DEFAULT_DEPOSIT_BUFFER", 50000000000000000n); // 0.05 STT
}

export type ConsensusTypeName = "majority" | "threshold";

export function getDefaultConsensusType(): ConsensusTypeName {
  const v = envVar("DEFAULT_CONSENSUS_TYPE", "majority");
  return v === "threshold" ? "threshold" : "majority";
}

export function getDefaultThreshold(subcommitteeSize: bigint): bigint {
  const raw = envVar("DEFAULT_THRESHOLD", "");
  if (raw) {
    try {
      return BigInt(raw);
    } catch {
      return subcommitteeSize / 2n + 1n;
    }
  }
  return subcommitteeSize / 2n + 1n;
}

export function getDefaultRequestTimeout(): bigint {
  return envBigInt("DEFAULT_REQUEST_TIMEOUT", 300n);
}

export function getRegistryAddress(): `0x${string}` | undefined {
  const v = envVar("REVERIE_REGISTRY_ADDRESS", "");
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`;
  return undefined;
}

export const RECEIPTS_BASE_URL =
  "https://agents.testnet.somnia.network/receipts";

export function getReceiptUrl(requestId: bigint): string {
  return `${RECEIPTS_BASE_URL}/${requestId.toString()}`;
}
