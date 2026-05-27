/**
 * Deploy the proxy-based REVERIE system to Somnia testnet.
 *
 * Deploys:
 *   - TimelockController
 *   - ReverieWorldInstance implementation
 *   - ReverieRegistry implementation + ERC1967 proxy owned by timelock
 *   - CallbackReceiver implementations + ERC1967 proxies owned by timelock
 */
import { network } from "hardhat";
import { encodeFunctionData, zeroAddress } from "viem";

const FALLBACK_PLATFORM_PRIMARY = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as `0x${string}`;
const FALLBACK_PLATFORM_LLM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as `0x${string}`;
const FALLBACK_AGENT_ID_LLM = 12847293847561029384n;
const FALLBACK_AGENT_ID_JSON_API = 13174292974160097713n;
const FALLBACK_AGENT_ID_WEB_PARSE = 12875401142070969085n;

const REGISTRY_INIT_ABI = [
  {
    name: "initialize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_treasury", type: "address" },
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
      { name: "_worldImplementation", type: "address" },
      { name: "initialOwner", type: "address" },
    ],
    outputs: [],
  },
] as const;

const CALLBACK_INIT_ABI = [
  {
    name: "initialize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "platform", type: "address" },
      { name: "initialOwner", type: "address" },
    ],
    outputs: [],
  },
] as const;

function envVar(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
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

function maybeAddress(key: string): `0x${string}` | undefined {
  const value = process.env[key];
  if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as `0x${string}`;
  return undefined;
}

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!pk || pk.trim() === "") {
    throw new Error("[DEPLOYER_PRIVATE_KEY missing] Set contracts/.env before deployment.");
  }

  const connection = await network.create();
  const viem = (connection as unknown as { viem?: unknown }).viem as
    | {
        getPublicClient: () => Promise<any>;
        getWalletClients: () => Promise<any[]>;
        deployContract: (name: string, args?: unknown[]) => Promise<any>;
      }
    | undefined;

  if (!viem) {
    throw new Error("[deploy.ts] Hardhat viem plugin is not available.");
  }

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const deployer = walletClient.account.address as `0x${string}`;
  const balance = await publicClient.getBalance({ address: deployer });
  const delay = Number(envBigInt("UPGRADE_DELAY_SECONDS", 86_400n));
  const proposer = maybeAddress("UPGRADE_PROPOSER_ADDRESS") ?? deployer;
  const executor = maybeAddress("UPGRADE_EXECUTOR_ADDRESS") ?? zeroAddress;
  const worldConfig = buildWorldConfig();

  console.log(`# DEPLOYER_ADDRESS=${deployer}`);
  console.log(`# DEPLOYER_BALANCE_WEI=${balance.toString()}`);
  console.log(`UPGRADE_DELAY_SECONDS=${delay}`);
  console.log(`UPGRADE_PROPOSER_ADDRESS=${proposer}`);
  console.log(`UPGRADE_EXECUTOR_ADDRESS=${executor}`);

  const timelock = await viem.deployContract("ReverieTimelockController", [
    delay,
    [proposer],
    [executor],
    zeroAddress,
  ]);
  console.log(`TIMELOCK_ADDRESS=${timelock.address}`);

  const worldImplementation = await viem.deployContract("ReverieWorldInstance");
  console.log(`WORLD_IMPLEMENTATION_ADDRESS=${worldImplementation.address}`);

  const registryImplementation = await viem.deployContract("ReverieRegistry");
  console.log(`REGISTRY_IMPLEMENTATION_ADDRESS=${registryImplementation.address}`);

  const registryInitData = encodeFunctionData({
    abi: REGISTRY_INIT_ABI,
    functionName: "initialize",
    args: [deployer, worldConfig, worldImplementation.address, timelock.address],
  });
  const registryProxy = await viem.deployContract("ReverieERC1967Proxy", [
    registryImplementation.address,
    registryInitData,
  ]);
  console.log(`REVERIE_REGISTRY_ADDRESS=${registryProxy.address}`);

  const callbackImplementation = await viem.deployContract("CallbackReceiver");
  console.log(`CALLBACK_RECEIVER_IMPLEMENTATION=${callbackImplementation.address}`);

  const callbackLlmInitData = encodeFunctionData({
    abi: CALLBACK_INIT_ABI,
    functionName: "initialize",
    args: [worldConfig.llmPlatform, timelock.address],
  });
  const callbackLlmProxy = await viem.deployContract("ReverieERC1967Proxy", [
    callbackImplementation.address,
    callbackLlmInitData,
  ]);
  console.log(`CALLBACK_RECEIVER_LLM=${callbackLlmProxy.address}`);

  const callbackPrimaryInitData = encodeFunctionData({
    abi: CALLBACK_INIT_ABI,
    functionName: "initialize",
    args: [worldConfig.jsonPlatform, timelock.address],
  });
  const callbackPrimaryProxy = await viem.deployContract("ReverieERC1967Proxy", [
    callbackImplementation.address,
    callbackPrimaryInitData,
  ]);
  console.log(`CALLBACK_RECEIVER_PRIMARY=${callbackPrimaryProxy.address}`);

  console.log("\n# Copy these values into contracts/.env and sdk/.env where relevant:");
  console.log(`TIMELOCK_ADDRESS=${timelock.address}`);
  console.log(`REGISTRY_IMPLEMENTATION_ADDRESS=${registryImplementation.address}`);
  console.log(`REVERIE_REGISTRY_ADDRESS=${registryProxy.address}`);
  console.log(`WORLD_IMPLEMENTATION_ADDRESS=${worldImplementation.address}`);
  console.log(`CALLBACK_RECEIVER_IMPLEMENTATION=${callbackImplementation.address}`);
  console.log(`CALLBACK_RECEIVER_LLM=${callbackLlmProxy.address}`);
  console.log(`CALLBACK_RECEIVER_PRIMARY=${callbackPrimaryProxy.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
