/**
 * @worldframe/sdk — WorldFrameSDK
 */
import {
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
import { createSdkPublicClient, resolveRpcUrl } from "./transports.js";
import type { SDKConfig, WorldRecord } from "./types.js";
import { compileWorldManifest, type CompiledWorldManifest } from "./manifest.js";

export class WorldFrameSDK {
  private publicClient: PublicClient;
  private walletClient: WalletClient<Transport, Chain, Account>;
  private account: Account | `0x${string}` | null = null;
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
      timeoutMs: config.timeoutMs ?? 300_000,
    };
    if (config.rpcUrl) agentKitConfig.rpcUrl = config.rpcUrl;
    if (config.wsUrl) agentKitConfig.wsUrl = config.wsUrl;
    if (config.callbackReceiverAddress) {
      agentKitConfig.callbackReceiverAddress = config.callbackReceiverAddress;
    }
    if (config.callbackReceiverLlm) {
      agentKitConfig.callbackReceiverLlm = config.callbackReceiverLlm;
    }
    if (config.callbackReceiverPrimary) {
      agentKitConfig.callbackReceiverPrimary = config.callbackReceiverPrimary;
    }

    this.publicClient = createSdkPublicClient({
      rpcUrl: config.rpcUrl,
      wsUrl: config.wsUrl,
    });
    const rpcUrl = resolveRpcUrl(config.rpcUrl);

    if (config.mode === "privateKey") {
      const account = privateKeyToAccount(config.privateKey);
      this.account = account;
      agentKitConfig.privateKey = config.privateKey;
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      }) as WalletClient<Transport, Chain, Account>;
    } else if (config.walletClient) {
      this.walletClient = config.walletClient;
      this.account = config.account ?? config.walletClient.account ?? null;
      agentKitConfig.walletClient = config.walletClient;
      if (config.account) agentKitConfig.account = config.account;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ethereum = (globalThis as any).ethereum;
      if (!ethereum) {
        throw new Error(
          "[WorldFrame SDK] No injected wallet found. Ensure MetaMask or a compatible wallet is installed."
        );
      }
      this.walletClient = createWalletClient({
        chain,
        transport: custom(ethereum),
      }) as unknown as WalletClient<Transport, Chain, Account>;
      this.account = this.walletClient.account ?? null;
      agentKitConfig.walletClient = this.walletClient;
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
    template: "fantasy" | "cyberpunk" | "void" | string;
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
      account: this.account ?? undefined,
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

  async deployWorldManifest(params: {
    name: string;
    template: string;
    builderConfig: unknown;
    subscribeTriggers?: boolean;
  }): Promise<{
    world: WorldInstance;
    worldAddress: `0x${string}`;
    deployTxHash: `0x${string}`;
    configureTxHash: `0x${string}`;
    subscriptionTxHashes: `0x${string}`[];
    manifest: CompiledWorldManifest;
  }> {
    if (!this.registryAddress) {
      throw new Error("Call setRegistry() or set REVERIE_REGISTRY_ADDRESS in .env");
    }

    const manifest = compileWorldManifest(params.builderConfig);
    if (manifest.unsupported.length > 0) {
      throw new Error(`World manifest is not live-deployable: ${manifest.unsupported.join("; ")}`);
    }

    const registrationFee = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "registrationFee",
    })) as bigint;

    const deployTxHash = await this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "deployWorld",
      args: [params.name, params.template],
      value: registrationFee,
    });

    await this.publicClient.waitForTransactionReceipt({ hash: deployTxHash });

    const [account] = await this.walletClient.getAddresses();
    const worlds = await this.getWorldsByOwner(account);
    const latest = worlds[worlds.length - 1];
    const world = this.useWorld(latest.worldAddress);
    const configureTxHash = await world.configureManifest(manifest);
    await this.publicClient.waitForTransactionReceipt({ hash: configureTxHash });

    const subscriptionTxHashes: `0x${string}`[] = [];
    if (params.subscribeTriggers) {
      for (const trigger of manifest.triggers) {
        if (trigger.triggerType !== 1 || trigger.emitter === "0x0000000000000000000000000000000000000000" || trigger.topic0 === `0x${"0".repeat(64)}`) {
          continue;
        }
        const txHash = await world.subscribeTrigger(trigger.triggerId);
        subscriptionTxHashes.push(txHash);
        await this.publicClient.waitForTransactionReceipt({ hash: txHash });
      }
    }

    return {
      world,
      worldAddress: latest.worldAddress,
      deployTxHash,
      configureTxHash,
      subscriptionTxHashes,
      manifest,
    };
  }

  useWorld(address: `0x${string}`): WorldInstance {
    return new WorldInstance(
      address,
      this.publicClient,
      this.walletClient,
      this.network,
      this.agentKit,
      this.account
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
