/**
 * @worldframe/sdk — WorldInstance
 */
import {
  parseEther,
  keccak256,
  toBytes,
  type PublicClient,
  type WalletClient,
  type Account,
  type Transport,
  type Chain,
} from "viem";
import { WORLD_INSTANCE_ABI } from "./abis.js";
import type {
  WorldEvent,
  WorldEventType,
  TriggerConfig,
  CostEstimate,
  Zone,
} from "./types.js";
import { AGENT_COSTS } from "./constants.js";
import type { SomniaAgentKit } from "./agentkit/SomniaAgentKit.js";
import { extractWorldRequestIdFromLogs } from "./utils/receipt.js";
import { ChronicleAgent } from "./agents/ChronicleAgent.js";
import { ZoneClimateAgent } from "./agents/ZoneClimateAgent.js";
import { FactionMoraleAgent } from "./agents/FactionMoraleAgent.js";
import { ConflictResolutionAgent } from "./agents/ConflictResolutionAgent.js";
import { TriggerManager, type ExtendedTriggerConfig } from "./reactivity/TriggerManager.js";

type EventCallback = (event: WorldEvent) => void;

export class WorldInstance {
  private worldAddress: `0x${string}`;
  private publicClient: PublicClient;
  private walletClient: WalletClient<Transport, Chain, Account>;
  private network: "testnet";
  private agentKit: SomniaAgentKit;
  private listeners: Map<WorldEventType | "all", EventCallback[]> = new Map();
  private unwatch: (() => void) | null = null;
  private triggerManager: TriggerManager;

  readonly agents: {
    chronicle: ChronicleAgent;
    zoneClimate: ZoneClimateAgent;
    factionMorale: FactionMoraleAgent;
    conflict: ConflictResolutionAgent;
  };

  constructor(
    worldAddress: `0x${string}`,
    publicClient: PublicClient,
    walletClient: WalletClient<Transport, Chain, Account>,
    network: "testnet",
    agentKit: SomniaAgentKit
  ) {
    this.worldAddress = worldAddress;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.network = network;
    this.agentKit = agentKit;
    this.triggerManager = new TriggerManager(
      this,
      publicClient,
      walletClient,
      agentKit
    );
    this.agents = {
      chronicle: new ChronicleAgent(this, agentKit),
      zoneClimate: new ZoneClimateAgent(this, agentKit),
      factionMorale: new FactionMoraleAgent(this, agentKit),
      conflict: new ConflictResolutionAgent(this, agentKit),
    };
  }

  get address(): `0x${string}` {
    return this.worldAddress;
  }

  get kit(): SomniaAgentKit {
    return this.agentKit;
  }

  async fund(amountStt: string): Promise<`0x${string}`> {
    return this.walletClient.sendTransaction({
      to: this.worldAddress,
      value: parseEther(amountStt),
    });
  }

  async setZone(params: {
    zoneId: `0x${string}`;
    name: string;
    dangerLevel: bigint;
    faction: string;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "setZone",
      args: [params.zoneId, params.name, params.dangerLevel, params.faction],
    });
  }

  async getZone(zoneId: `0x${string}`): Promise<Zone> {
    const result = await this.publicClient.readContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "zones",
      args: [zoneId],
    });
    const [name, dangerLevel, controllingFaction, climateState] = result as [
      string,
      bigint,
      string,
      string
    ];
    return { id: zoneId, name, dangerLevel, controllingFaction, climateState };
  }

  async installModule(params: {
    moduleId: `0x${string}`;
    moduleAddress: `0x${string}`;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "installModule",
      args: [params.moduleId, params.moduleAddress],
    });
  }

  async removeModule(moduleId: `0x${string}`): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "removeModule",
      args: [moduleId],
    });
  }

  async getModule(moduleId: `0x${string}`): Promise<`0x${string}`> {
    return (await this.publicClient.readContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "getModule",
      args: [moduleId],
    })) as `0x${string}`;
  }

  async executeModule(params: {
    moduleId: `0x${string}`;
    data: `0x${string}`;
    value?: string;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "executeModule",
      args: [params.moduleId, params.data],
      value: params.value ? parseEther(params.value) : 0n,
    });
  }

  async upgradeToAndCall(params: {
    newImplementation: `0x${string}`;
    data?: `0x${string}`;
    value?: string;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "upgradeToAndCall",
      args: [params.newImplementation, params.data ?? "0x"],
      value: params.value ? parseEther(params.value) : 0n,
    });
  }

  async requestAgentDecision(params: {
    triggerId: `0x${string}`;
    prompt: string;
    system: string;
    allowedValues?: string[];
    cooldownSeconds?: number;
    value?: string;
  }): Promise<{ requestId: bigint; txHash: `0x${string}` }> {
    const hash = await this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "requestAgentDecision",
      args: [
        params.triggerId,
        params.prompt,
        params.system,
        params.allowedValues ?? [],
        BigInt(params.cooldownSeconds ?? 0),
      ],
      value: params.value ? parseEther(params.value) : 0n,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const requestId = extractWorldRequestIdFromLogs(receipt.logs);
    return { requestId, txHash: hash };
  }

  async requestChronicleOnChain(params: {
    triggerId: `0x${string}`;
    rawEvent: string;
    system: string;
    cooldownSeconds?: number;
    value?: string;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "chronicleFromAgent",
      args: [
        params.triggerId,
        params.rawEvent,
        params.system,
        BigInt(params.cooldownSeconds ?? 60),
      ],
      value: params.value ? parseEther(params.value) : 0n,
    });
  }

  async recordChronicleEntry(description: string): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "recordChronicleEntry",
      args: [description],
    });
  }

  async applyClimateResult(
    zoneId: `0x${string}`,
    climateState: string
  ): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "applyClimateResult",
      args: [zoneId, climateState],
    });
  }

  async applyConflictOutcome(
    zoneId: `0x${string}`,
    outcome: string
  ): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "applyConflictOutcome",
      args: [zoneId, outcome],
    });
  }

  async updateFactionMorale(
    factionId: string,
    moraleDelta: bigint,
    narrative: string
  ): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "updateFactionMorale",
      args: [factionId, moraleDelta, narrative],
    });
  }

  /** Watch AgentDecisionReceived for a specific requestId (Lane B). */
  onAgentResult(
    requestId: bigint,
    callback: (result: string) => void
  ): () => void {
    return this.publicClient.watchContractEvent({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      eventName: "AgentDecisionReceived",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as { requestId?: bigint; result?: string };
          if (args.requestId === requestId && args.result) {
            callback(args.result);
          }
        }
      },
    });
  }

  async parseRequestIdFromTx(txHash: `0x${string}`): Promise<bigint> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return extractWorldRequestIdFromLogs(receipt.logs);
  }

  estimateCost(agentType: "llm" | "json_api" | "parse_website"): CostEstimate {
    const costMap = {
      llm: AGENT_COSTS.LLM_INFERENCE,
      json_api: AGENT_COSTS.JSON_API,
      parse_website: AGENT_COSTS.LLM_PARSE_WEBSITE,
    };
    const cost = costMap[agentType];
    return {
      depositRequired: `${cost} STT`,
      agentType,
      note: "Drawn from world contract STT balance in autonomous mode.",
    };
  }

  addTrigger(config: TriggerConfig): () => void {
    const extended: ExtendedTriggerConfig = {
      ...config,
      triggerId:
        config.triggerId ??
        keccak256(toBytes(`trigger:${config.agent}:${Date.now()}`)),
      cooldownSeconds: config.cooldownSeconds ?? 300,
    };
    return this.triggerManager.addTrigger(extended);
  }

  onEvent(callback: EventCallback): () => void {
    this._addListener("all", callback);
    this._ensureWatching();
    return () => this._removeListener("all", callback);
  }

  on(type: WorldEventType, callback: EventCallback): () => void {
    this._addListener(type, callback);
    this._ensureWatching();
    return () => this._removeListener(type, callback);
  }

  private _addListener(key: WorldEventType | "all", cb: EventCallback) {
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key)!.push(cb);
  }

  private _removeListener(key: WorldEventType | "all", cb: EventCallback) {
    const list = this.listeners.get(key) ?? [];
    this.listeners.set(
      key,
      list.filter((fn) => fn !== cb)
    );
  }

  private _emit(event: WorldEvent) {
    const specific = this.listeners.get(event.type) ?? [];
    const all = this.listeners.get("all") ?? [];
    [...specific, ...all].forEach((cb) => cb(event));
  }

  private _ensureWatching() {
    if (this.unwatch) return;

    const unwatchDecision = this.publicClient.watchContractEvent({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      eventName: "AgentDecisionReceived",
      onLogs: (logs) => {
        for (const log of logs) {
          this._emit({
            type: "agent_decision",
            timestamp: Date.now(),
            description: (log.args as { result?: string }).result,
            requestId: (log.args as { requestId?: bigint }).requestId,
          });
        }
      },
    });

    const unwatchChronicle = this.publicClient.watchContractEvent({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      eventName: "ChronicleAdded",
      onLogs: (logs) => {
        for (const log of logs) {
          this._emit({
            type: "chronicle_entry",
            timestamp: Date.now(),
            description: (log.args as { description?: string }).description,
          });
        }
      },
    });

    const unwatchZone = this.publicClient.watchContractEvent({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      eventName: "ZoneUpdated",
      onLogs: (logs) => {
        for (const log of logs) {
          this._emit({
            type: "zone_updated",
            timestamp: Date.now(),
            data: log.args as Record<string, unknown>,
          });
        }
      },
    });

    this.unwatch = () => {
      unwatchDecision();
      unwatchChronicle();
      unwatchZone();
    };
  }

  disconnect() {
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
    this.triggerManager.clearAll();
    this.agentKit.destroy();
  }

  static triggerId(key: string): `0x${string}` {
    return keccak256(toBytes(key));
  }
}
