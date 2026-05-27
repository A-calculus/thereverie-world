/**
 * @worldframe/sdk — WorldFrameSDK
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
  type Transport,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { custom } from "viem";
import { somniaTestnet } from "./constants.js";
import { REGISTRY_ABI } from "./abis.js";
import { WorldInstance } from "./WorldInstance.js";
import { SomniaAgentKit } from "./agentkit/SomniaAgentKit.js";
import { getRegistryAddress } from "./agentkit/contracts/addresses.js";
import { NativeAgents } from "./native/index.js";
import type { SDKConfig, WorldRecord } from "./types.js";

export class WorldFrameSDK {
  private publicClient: PublicClient;
  private walletClient: WalletClient<Transport, Chain, Account>;
  private network: "testnet";
  private registryAddress: `0x${string}` | null = null;
  private agentKit: SomniaAgentKit;
  private nativeAgents: NativeAgents;

  constructor(config: SDKConfig) {
    if ((config as { network: string }).network !== "testnet") {
      throw new Error("[WorldFrame SDK] Only Somnia testnet is supported.");
    }
    this.network = config.network;
    const chain = somniaTestnet;

    const agentKitConfig: Record<string, unknown> = {
      network: "testnet",
      timeoutMs: 300_000,
    };

    if (config.mode === "privateKey") {
      const account = privateKeyToAccount(config.privateKey);
      agentKitConfig.privateKey = config.privateKey;
      this.publicClient = createPublicClient({
        chain,
        transport: http(chain.rpcUrls.default.http[0]),
      }) as PublicClient;
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(chain.rpcUrls.default.http[0]),
      }) as WalletClient<Transport, Chain, Account>;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ethereum = (globalThis as any).ethereum;
      if (!ethereum) {
        throw new Error(
          "[WorldFrame SDK] No injected wallet found. Ensure MetaMask or a compatible wallet is installed."
        );
      }
      this.publicClient = createPublicClient({
        chain,
        transport: http(chain.rpcUrls.default.http[0]),
      }) as PublicClient;
      this.walletClient = createWalletClient({
        chain,
        transport: custom(ethereum),
      }) as unknown as WalletClient<Transport, Chain, Account>;
    }

    this.agentKit = new SomniaAgentKit(agentKitConfig);
    this.nativeAgents = new NativeAgents(this.agentKit);

    const envRegistry = getRegistryAddress();
    if (envRegistry) {
      this.registryAddress = envRegistry;
    }
  }

  getAgentKit(): SomniaAgentKit {
    return this.agentKit;
  }

  /** Somnia native agents (LLM, JSON API, Web Parse) — Lane A, builder wallet */
  get native(): NativeAgents {
    return this.nativeAgents;
  }

  getNativeAgents(): NativeAgents {
    return this.nativeAgents;
  }

  setRegistry(address: `0x${string}`): this {
    this.registryAddress = address;
    return this;
  }

  async deployWorld(params: {
    name: string;
    template: "fantasy" | "cyberpunk" | "void";
  }): Promise<WorldInstance> {
    if (!this.registryAddress) {
      throw new Error("Call setRegistry() or set REVERIE_REGISTRY_ADDRESS in .env");
    }

    const registrationFee = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "registrationFee",
    })) as bigint;

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "deployWorld",
      args: [params.name, params.template],
      value: registrationFee,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    const [accounts] = await this.walletClient.getAddresses();
    const worlds = await this.getWorldsByOwner(accounts);
    const latest = worlds[worlds.length - 1];

    return this.useWorld(latest.worldAddress);
  }

  useWorld(address: `0x${string}`): WorldInstance {
    return new WorldInstance(
      address,
      this.publicClient,
      this.walletClient,
      this.network,
      this.agentKit
    );
  }

  async getWorldsByOwner(owner: `0x${string}`): Promise<WorldRecord[]> {
    if (!this.registryAddress) {
      throw new Error("Call setRegistry() or set REVERIE_REGISTRY_ADDRESS in .env");
    }

    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "getWorldsByOwner",
      args: [owner],
    });

    return (
      result as { worldAddress: `0x${string}`; name: string; template: string }[]
    ).map((r) => ({
      worldAddress: r.worldAddress,
      name: r.name,
      template: r.template,
    }));
  }

  async getAllWorlds(): Promise<WorldRecord[]> {
    if (!this.registryAddress) {
      throw new Error("Call setRegistry() or set REVERIE_REGISTRY_ADDRESS in .env");
    }

    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "getAllWorlds",
    });

    return (
      result as { worldAddress: `0x${string}`; name: string; template: string }[]
    ).map((r) => ({
      worldAddress: r.worldAddress,
      name: r.name,
      template: r.template,
    }));
  }
}
