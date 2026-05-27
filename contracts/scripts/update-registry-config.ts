/**
 * Update an existing ReverieRegistry worldConfig on Somnia testnet.
 *
 * This does not upgrade deployed bytecode.
 * It schedules or executes the config update through the TimelockController.
 *
 * Usage:
 *   REVERIE_REGISTRY_ADDRESS=0x... npm run update:testnet
 */
import { network } from "hardhat";
import { encodeFunctionData, keccak256, toBytes, zeroHash } from "viem";

const TIMELOCK_ABI = [
  {
    name: "schedule",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
      { name: "delay", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "payload", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const REGISTRY_ABI = [
  {
    name: "setWorldConfig",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_worldConfig",
        type: "tuple",
        components: [
          { name: "llmPlatform", type: "address" },
          { name: "jsonPlatform", type: "address" },
          { name: "llmAgentId", type: "uint256" },
          { name: "jsonAgentId", type: "uint256" },
          { name: "webParseAgentId", type: "uint256" },
          { name: "subcommitteeSize", type: "uint256" },
          { name: "defaultConsensusType", type: "uint8" },
          { name: "defaultThreshold", type: "uint256" },
          { name: "defaultTimeout", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const FALLBACK_PLATFORM_PRIMARY = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as `0x${string}`;
const FALLBACK_PLATFORM_LLM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as `0x${string}`;
const FALLBACK_AGENT_ID_LLM = 12847293847561029384n;
const FALLBACK_AGENT_ID_JSON_API = 13174292974160097713n;
const FALLBACK_AGENT_ID_WEB_PARSE = 12875401142070969085n;

function envVar(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function requiredAddress(key: string): `0x${string}` {
  const value = process.env[key];
  if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value as `0x${string}`;
  }
  throw new Error(`[${key} missing] Set ${key}=0x... in contracts/.env`);
}

function envAddress(key: string, fallback: `0x${string}`): `0x${string}` {
  const value = envVar(key, fallback);
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as `0x${string}`) : fallback;
}

function envBigInt(key: string, fallback: bigint): bigint {
  try {
    return BigInt(envVar(key, fallback.toString()));
  } catch {
    return fallback;
  }
}

function defaultThreshold(subcommitteeSize: bigint): bigint {
  const explicit = process.env.DEFAULT_THRESHOLD;
  if (explicit && explicit.trim() !== "") {
    return envBigInt("DEFAULT_THRESHOLD", subcommitteeSize / 2n + 1n);
  }
  return subcommitteeSize / 2n + 1n;
}

function defaultConsensusType(): 0 | 1 {
  return process.env.DEFAULT_CONSENSUS_TYPE === "threshold" ? 1 : 0;
}

function buildWorldConfig() {
  const subcommitteeSize = envBigInt("DEFAULT_SUBCOMMITTEE_SIZE", 3n);
  return {
    llmPlatform: envAddress("SOMNIA_PLATFORM_LLM", FALLBACK_PLATFORM_LLM),
    jsonPlatform: envAddress("SOMNIA_PLATFORM_PRIMARY", FALLBACK_PLATFORM_PRIMARY),
    llmAgentId: envBigInt("SOMNIA_AGENT_ID_LLM", FALLBACK_AGENT_ID_LLM),
    jsonAgentId: envBigInt("SOMNIA_AGENT_ID_JSON_API", FALLBACK_AGENT_ID_JSON_API),
    webParseAgentId: envBigInt("SOMNIA_AGENT_ID_WEB_PARSE", FALLBACK_AGENT_ID_WEB_PARSE),
    subcommitteeSize,
    defaultConsensusType: defaultConsensusType(),
    defaultThreshold: defaultThreshold(subcommitteeSize),
    defaultTimeout: envBigInt("DEFAULT_REQUEST_TIMEOUT", 300n),
  };
}

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!pk || pk.trim() === "") {
    throw new Error("[DEPLOYER_PRIVATE_KEY missing] Set the registry treasury/deployer key.");
  }

  const registryAddress = requiredAddress("REVERIE_REGISTRY_ADDRESS");
  const timelock = requiredAddress("TIMELOCK_ADDRESS");
  const nextConfig = buildWorldConfig();
  const action = process.env.TIMELOCK_ACTION ?? "schedule";
  const delay = BigInt(process.env.UPGRADE_DELAY_SECONDS ?? "86400");
  const connection = await network.create();
  const viem = (connection as unknown as { viem?: unknown }).viem as
    | {
        getWalletClients: () => Promise<any[]>;
      }
    | undefined;

  if (!viem) {
    throw new Error("[update-registry-config.ts] Hardhat viem plugin is not available.");
  }

  const [walletClient] = await viem.getWalletClients();
  const deployerAddress = walletClient.account.address as `0x${string}`;

  console.log(`REVERIE_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`TIMELOCK_ADDRESS=${timelock}`);
  console.log(`# DEPLOYER_ADDRESS=${deployerAddress}`);
  console.log(`TIMELOCK_ACTION=${action}`);
  console.log(`UPGRADE_DELAY_SECONDS=${delay.toString()}`);
  console.log(`SOMNIA_PLATFORM_LLM=${nextConfig.llmPlatform}`);
  console.log(`SOMNIA_PLATFORM_PRIMARY=${nextConfig.jsonPlatform}`);
  console.log(`SOMNIA_AGENT_ID_LLM=${nextConfig.llmAgentId.toString()}`);
  console.log(`SOMNIA_AGENT_ID_JSON_API=${nextConfig.jsonAgentId.toString()}`);
  console.log(`SOMNIA_AGENT_ID_WEB_PARSE=${nextConfig.webParseAgentId.toString()}`);
  console.log(`DEFAULT_SUBCOMMITTEE_SIZE=${nextConfig.subcommitteeSize.toString()}`);
  console.log(`DEFAULT_CONSENSUS_TYPE=${nextConfig.defaultConsensusType === 1 ? "threshold" : "majority"}`);
  console.log(`DEFAULT_THRESHOLD=${nextConfig.defaultThreshold.toString()}`);
  console.log(`DEFAULT_REQUEST_TIMEOUT=${nextConfig.defaultTimeout.toString()}`);

  const payload = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "setWorldConfig",
    args: [nextConfig],
  });
  const operationSalt = keccak256(
    toBytes(
      process.env.TIMELOCK_SALT ??
        `reverie:update-world-config:${nextConfig.llmPlatform}:${nextConfig.jsonPlatform}:${nextConfig.subcommitteeSize.toString()}:${nextConfig.defaultThreshold.toString()}`
    )
  );

  const hash = await walletClient.writeContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: action === "execute" ? "execute" : "schedule",
    args:
      action === "execute"
        ? [registryAddress, 0n, payload, zeroHash, operationSalt]
        : [registryAddress, 0n, payload, zeroHash, operationSalt, delay],
  });

  console.log(`TIMELOCK_TX_HASH=${hash}`);
  console.log(`TIMELOCK_SALT=${operationSalt}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
