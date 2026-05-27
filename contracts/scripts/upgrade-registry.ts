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

const UUPS_ABI = [
  {
    name: "upgradeToAndCall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "newImplementation", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function requiredAddress(key: string): `0x${string}` {
  const value = process.env[key];
  if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as `0x${string}`;
  throw new Error(`[${key} missing] Set ${key}=0x... in contracts/.env`);
}

function salt(defaultLabel: string): `0x${string}` {
  return keccak256(toBytes(process.env.TIMELOCK_SALT ?? defaultLabel));
}

async function main() {
  const connection = await network.create();
  const viem = (connection as unknown as { viem?: unknown }).viem as
    | {
        getWalletClients: () => Promise<any[]>;
        deployContract: (name: string, args?: unknown[]) => Promise<any>;
      }
    | undefined;
  if (!viem) throw new Error("[upgrade-registry.ts] Hardhat viem plugin is not available.");

  const [walletClient] = await viem.getWalletClients();
  const timelock = requiredAddress("TIMELOCK_ADDRESS");
  const registryProxy = requiredAddress("REVERIE_REGISTRY_ADDRESS");
  const action = process.env.TIMELOCK_ACTION ?? "schedule";
  const delay = BigInt(process.env.UPGRADE_DELAY_SECONDS ?? "86400");

  const implementation =
    process.env.NEW_REGISTRY_IMPLEMENTATION_ADDRESS &&
    /^0x[0-9a-fA-F]{40}$/.test(process.env.NEW_REGISTRY_IMPLEMENTATION_ADDRESS)
      ? (process.env.NEW_REGISTRY_IMPLEMENTATION_ADDRESS as `0x${string}`)
      : (await viem.deployContract("ReverieRegistry")).address;

  const payload = encodeFunctionData({
    abi: UUPS_ABI,
    functionName: "upgradeToAndCall",
    args: [implementation, "0x"],
  });
  const operationSalt = salt(`reverie:upgrade:registry:${implementation}`);

  const hash = await walletClient.writeContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: action === "execute" ? "execute" : "schedule",
    args:
      action === "execute"
        ? [registryProxy, 0n, payload, zeroHash, operationSalt]
        : [registryProxy, 0n, payload, zeroHash, operationSalt, delay],
  });

  console.log(`TIMELOCK_ACTION=${action}`);
  console.log(`TIMELOCK_ADDRESS=${timelock}`);
  console.log(`REVERIE_REGISTRY_ADDRESS=${registryProxy}`);
  console.log(`UPGRADE_DELAY_SECONDS=${delay.toString()}`);
  console.log(`NEW_REGISTRY_IMPLEMENTATION_ADDRESS=${implementation}`);
  console.log(`TIMELOCK_TX_HASH=${hash}`);
  console.log(`TIMELOCK_SALT=${operationSalt}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
