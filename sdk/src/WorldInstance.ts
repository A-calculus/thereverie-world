/**
 * @worldframe/sdk — WorldInstance
 */
import {
  formatEther,
  parseEther,
  keccak256,
  toBytes,
  toFunctionSelector,
  toEventSelector,
  numberToHex,
  type Log,
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
import type { CompiledWorldManifest } from "./manifest.js";
import {
  decodeWorldRuntimeLogs,
  verifyReceiptSummary,
  worldExplorerLinks,
  decodeReactivitySubscriptionLogs,
  type DecodedWorldRuntimeEvent,
  type DecodedReactivitySubscriptionEvent,
  type VerifiedTransaction,
} from "./runtime-events.js";

type EventCallback = (event: WorldEvent) => void;

const REACTIVITY_PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000100" as `0x${string}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;
const REACTIVITY_PRECOMPILE_ABI = [
  {
    type: "function",
    name: "subscribe",
    stateMutability: "nonpayable",
    inputs: [{
      name: "subscriptionData",
      type: "tuple",
      components: [
        { name: "eventTopics", type: "bytes32[4]" },
        { name: "origin", type: "address" },
        { name: "caller", type: "address" },
        { name: "emitter", type: "address" },
        { name: "handlerContractAddress", type: "address" },
        { name: "handlerFunctionSelector", type: "bytes4" },
        { name: "priorityFeePerGas", type: "uint64" },
        { name: "maxFeePerGas", type: "uint64" },
        { name: "gasLimit", type: "uint64" },
        { name: "isGuaranteed", type: "bool" },
        { name: "isCoalesced", type: "bool" },
      ],
    }],
    outputs: [{ name: "subscriptionId", type: "uint256" }],
  },
] as const;

type TriggerSubscriptionRecord = {
  triggerId: `0x${string}`;
  triggerType: "contract_event" | "scheduled";
  txHash: `0x${string}`;
  transaction: VerifiedTransaction;
  events: DecodedWorldRuntimeEvent[];
  reactivityEvents: DecodedReactivitySubscriptionEvent[];
  emitter: `0x${string}`;
  topic0: `0x${string}`;
  topic1?: `0x${string}`;
  gasLimit: string;
  scheduleNextTimestampMs?: string;
  scheduleIntervalSeconds?: string;
  handlerContractAddress: `0x${string}`;
};

function manifestTriggersForContract(manifest: CompiledWorldManifest) {
  return manifest.triggers.map((trigger) => ({
    triggerId: trigger.triggerId,
    active: trigger.active,
    triggerType: trigger.triggerType,
    emitter: trigger.emitter,
    topic0: trigger.topic0,
    topic1: trigger.topic1,
    gasLimit: trigger.gasLimit,
    cooldownSeconds: trigger.cooldownSeconds,
    scheduleIntervalSeconds: trigger.scheduleIntervalSeconds,
    scheduleNextTimestampMs: trigger.scheduleNextTimestampMs,
    firstStep: trigger.firstStep,
    stepCount: trigger.stepCount,
  }));
}

function manifestZonesForContract(manifest: CompiledWorldManifest) {
  return manifest.zones.map((zone) => ({
    zoneId: zone.zoneId,
    name: zone.name,
    dangerLevel: zone.dangerLevel,
    faction: zone.faction,
  }));
}

function manifestFactionsForContract(manifest: CompiledWorldManifest) {
  return manifest.factions.map((faction) => ({
    factionId: faction.factionId,
    name: faction.name,
    morale: faction.morale,
    narrative: faction.narrative,
  }));
}

export class WorldInstance {
  private worldAddress: `0x${string}`;
  private publicClient: PublicClient;
  private walletClient: WalletClient<Transport, Chain, Account>;
  private account: Account | `0x${string}` | null;
  readonly network: "testnet";
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
    agentKit: SomniaAgentKit,
    account: Account | `0x${string}` | null = walletClient.account ?? null
  ) {
    this.worldAddress = worldAddress;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.account = account;
    this.network = network;
    this.agentKit = agentKit;
    this.triggerManager = new TriggerManager(
      this,
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
      account: this.account ?? undefined,
      to: this.worldAddress,
      value: parseEther(amountStt),
    });
  }

  async waitForTransaction(txHash: `0x${string}`): Promise<void> {
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  async verifyTransaction(txHash: `0x${string}`): Promise<{
    transaction: VerifiedTransaction;
    events: DecodedWorldRuntimeEvent[];
    reactivityEvents: DecodedReactivitySubscriptionEvent[];
  }> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return {
      transaction: verifyReceiptSummary(receipt),
      events: decodeWorldRuntimeLogs(receipt.logs),
      reactivityEvents: decodeReactivitySubscriptionLogs(receipt.logs),
    };
  }

  async getBalance(): Promise<string> {
    return formatEther(await this.publicClient.getBalance({ address: this.worldAddress }));
  }

  async getVerifiedBalance(): Promise<{ balanceWei: string; balanceStt: string }> {
    const balance = await this.publicClient.getBalance({ address: this.worldAddress });
    return { balanceWei: balance.toString(), balanceStt: formatEther(balance) };
  }

  getExplorerLinks(): { address: `0x${string}`; addressUrl: string } {
    return worldExplorerLinks(this.worldAddress);
  }

  async fundAndVerify(amountStt: string): Promise<{
    txHash: `0x${string}`;
    transaction: VerifiedTransaction;
    balanceWei: string;
    balanceStt: string;
  }> {
    const txHash = await this.fund(amountStt);
    const { transaction } = await this.verifyTransaction(txHash);
    if (transaction.status !== "success") {
      throw new Error(`World funding transaction failed: ${txHash}`);
    }
    const balance = await this.getVerifiedBalance();
    return { txHash, transaction, ...balance };
  }

  async configureManifest(manifest: CompiledWorldManifest): Promise<`0x${string}`> {
    if (manifest.unsupported.length > 0) {
      throw new Error(`Manifest contains unsupported workflow steps: ${manifest.unsupported.join("; ")}`);
    }
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "configureManifest",
      args: [
        manifest.manifestHash,
        manifestZonesForContract(manifest),
        manifestFactionsForContract(manifest),
        manifestTriggersForContract(manifest),
        manifest.steps,
        manifest.decisionContinuations,
      ] as never,
    });
  }

  async armWorld(): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "armWorld",
      args: [],
    });
  }

  async pauseWorld(): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "pauseWorld",
      args: [],
    });
  }

  async stopWorld(reason = "Stopped by world owner."): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "stopWorld",
      args: [reason],
    });
  }

  async withdraw(): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "withdraw",
      args: [],
    });
  }

  async withdrawAndVerify(): Promise<{
    txHash: `0x${string}`;
    transaction: VerifiedTransaction;
    balanceWei: string;
    balanceStt: string;
  }> {
    const txHash = await this.withdraw();
    const { transaction } = await this.verifyTransaction(txHash);
    if (transaction.status !== "success") {
      throw new Error(`World withdraw transaction failed: ${txHash}`);
    }
    const balance = await this.getVerifiedBalance();
    return { txHash, transaction, ...balance };
  }

  async fireManualTrigger(params: {
    triggerId: `0x${string}`;
    context?: string;
    value?: string;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "fireManualTrigger",
      args: [params.triggerId, params.context ?? "manual_trigger"],
      value: params.value ? parseEther(params.value) : 0n,
    });
  }

  async fireManualTriggerAndParse(params: {
    triggerId: `0x${string}`;
    context?: string;
    value?: string;
  }): Promise<{
    txHash: `0x${string}`;
    transaction: VerifiedTransaction;
    events: DecodedWorldRuntimeEvent[];
    requestIds: string[];
  }> {
    const txHash = await this.fireManualTrigger(params);
    const verified = await this.verifyTransaction(txHash);
    if (verified.transaction.status !== "success") {
      throw new Error(`Manual trigger transaction failed: ${txHash}`);
    }
    const requestIds = [...new Set(verified.events.map((event) => event.requestId).filter((id): id is string => Boolean(id)))];
    return { txHash, transaction: verified.transaction, events: verified.events, requestIds };
  }

  async subscribeTrigger(triggerId: `0x${string}`): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "subscribeTrigger",
      args: [triggerId],
    });
  }

  async scheduleTrigger(trigger: Pick<CompiledWorldManifest["triggers"][number], "triggerId" | "triggerType" | "scheduleNextTimestampMs" | "scheduleIntervalSeconds" | "gasLimit">): Promise<`0x${string}`> {
    if (trigger.triggerType !== 2) {
      throw new Error("scheduleTrigger can only schedule manifest scheduled triggers.");
    }
    const timestampMs = Number(trigger.scheduleNextTimestampMs);
    if (!Number.isFinite(timestampMs) || timestampMs < Date.now() + 12_000) {
      throw new Error("Scheduled trigger timestamp must be at least 12 seconds in the future.");
    }
    const fees = await this.publicClient.estimateFeesPerGas().catch(() => null);
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: REACTIVITY_PRECOMPILE_ADDRESS,
      abi: REACTIVITY_PRECOMPILE_ABI,
      functionName: "subscribe",
      args: [{
        eventTopics: [
          toEventSelector({
            name: "Schedule",
            type: "event",
            inputs: [{ name: "timestampMillis", type: "uint256", indexed: true }],
          }),
          numberToHex(BigInt(timestampMs), { size: 32 }),
          ZERO_BYTES32,
          ZERO_BYTES32,
        ],
        origin: ZERO_ADDRESS,
        caller: ZERO_ADDRESS,
        emitter: ZERO_ADDRESS,
        handlerContractAddress: this.worldAddress,
        handlerFunctionSelector: toFunctionSelector({
        name: "onEvent",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "emitter", type: "address" },
          { name: "eventTopics", type: "bytes32[]" },
          { name: "data", type: "bytes" },
        ],
        outputs: [],
        }),
        priorityFeePerGas: fees?.maxPriorityFeePerGas ?? 1n,
        maxFeePerGas: fees?.maxFeePerGas ?? 1n,
        gasLimit: trigger.gasLimit > 0n ? trigger.gasLimit : 500_000n,
        isGuaranteed: true,
        isCoalesced: false,
      }],
    });
  }

  async unsubscribeTrigger(triggerId: `0x${string}`): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "unsubscribeTrigger",
      args: [triggerId],
    });
  }

  async subscribeManifestTriggers(manifest: CompiledWorldManifest): Promise<{
    txHashes: `0x${string}`[];
    transactions: VerifiedTransaction[];
    events: DecodedWorldRuntimeEvent[];
    reactivityEvents: DecodedReactivitySubscriptionEvent[];
    subscriptions: TriggerSubscriptionRecord[];
  }> {
    const txHashes: `0x${string}`[] = [];
    const transactions: VerifiedTransaction[] = [];
    const events: DecodedWorldRuntimeEvent[] = [];
    const reactivityEvents: DecodedReactivitySubscriptionEvent[] = [];
    const subscriptions: TriggerSubscriptionRecord[] = [];
    for (const trigger of manifest.triggers) {
      if (
        (trigger.triggerType !== 1 && trigger.triggerType !== 2) ||
        (trigger.triggerType !== 2 && trigger.emitter === "0x0000000000000000000000000000000000000000") ||
        trigger.topic0 === `0x${"0".repeat(64)}`
      ) {
        continue;
      }
      const txHash = trigger.triggerType === 2
        ? await this.scheduleTrigger(trigger)
        : await this.subscribeTrigger(trigger.triggerId);
      const verified = await this.verifyTransaction(txHash);
      if (verified.transaction.status !== "success") {
        throw new Error(`Trigger subscription failed: ${txHash}`);
      }
      txHashes.push(txHash);
      transactions.push(verified.transaction);
      events.push(...verified.events);
      reactivityEvents.push(...verified.reactivityEvents);
      subscriptions.push({
        triggerId: trigger.triggerId,
        triggerType: trigger.triggerType === 2 ? "scheduled" : "contract_event",
        txHash,
        transaction: verified.transaction,
        events: verified.events,
        reactivityEvents: verified.reactivityEvents,
        emitter: trigger.emitter,
        topic0: trigger.topic0,
        topic1: trigger.topic1,
        gasLimit: trigger.gasLimit.toString(),
        scheduleNextTimestampMs: trigger.scheduleNextTimestampMs > 0n ? trigger.scheduleNextTimestampMs.toString() : undefined,
        scheduleIntervalSeconds: trigger.scheduleIntervalSeconds > 0n ? trigger.scheduleIntervalSeconds.toString() : undefined,
        handlerContractAddress: this.worldAddress,
      });
    }
    return { txHashes, transactions, events, reactivityEvents, subscriptions };
  }

  async getLiveState(): Promise<{
    address: `0x${string}`;
    balanceStt: string;
    manifestHash: `0x${string}`;
    lifecycleStatus: number;
    counts: { zoneCount: bigint; factionCount: bigint; triggerCount: bigint; stepCount: bigint };
  }> {
    const [balance, manifestHash, lifecycleStatus, counts] = await Promise.all([
      this.getBalance(),
      this.publicClient.readContract({
        address: this.worldAddress,
        abi: WORLD_INSTANCE_ABI,
        functionName: "manifestHash",
      }) as Promise<`0x${string}`>,
      this.publicClient.readContract({
        address: this.worldAddress,
        abi: WORLD_INSTANCE_ABI,
        functionName: "lifecycleStatus",
      }) as Promise<number>,
      this.publicClient.readContract({
        address: this.worldAddress,
        abi: WORLD_INSTANCE_ABI,
        functionName: "getManifestCounts",
      }) as Promise<[bigint, bigint, bigint, bigint]>,
    ]);
    return {
      address: this.worldAddress,
      balanceStt: balance,
      manifestHash,
      lifecycleStatus: Number(lifecycleStatus),
      counts: {
        zoneCount: counts[0],
        factionCount: counts[1],
        triggerCount: counts[2],
        stepCount: counts[3],
      },
    };
  }

  async getWorkflowEvents(params: {
    fromBlock?: bigint | number | string;
    toBlock?: bigint | number | string | "latest";
  } = {}): Promise<DecodedWorldRuntimeEvent[]> {
    const fromBlock = params.fromBlock === undefined ? undefined : BigInt(params.fromBlock);
    const toBlock = params.toBlock === undefined || params.toBlock === "latest" ? undefined : BigInt(params.toBlock);
    const logs = await this.publicClient.getLogs({
      address: this.worldAddress,
      fromBlock,
      toBlock,
    }) as Log[];
    return decodeWorldRuntimeLogs(logs);
  }

  async setZone(params: {
    zoneId: `0x${string}`;
    name: string;
    dangerLevel: bigint;
    faction: string;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
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

  async getFactionMorale(factionId: string): Promise<{
    factionId: string;
    moraleDelta: bigint;
    narrative: string;
    updatedAt: bigint;
  }> {
    const result = await this.publicClient.readContract({
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "factionMorale",
      args: [factionId],
    });
    const [moraleDelta, narrative, updatedAt] = result as [bigint, string, bigint];
    return { factionId, moraleDelta, narrative, updatedAt };
  }

  async hydrateManifestState(manifest: CompiledWorldManifest): Promise<{
    zones: Array<Zone & { slug?: string; allocationWeightBps?: bigint }>;
    factions: Array<{
      factionId: string;
      name: string;
      moraleDelta: bigint;
      narrative: string;
      updatedAt: bigint;
      allocationWeightBps?: bigint;
    }>;
  }> {
    const zoneWeights = new Map(
      manifest.relationships
        .filter((relationship) => relationship.sourceType === "zone" && relationship.targetType === "world")
        .map((relationship) => [relationship.sourceId, relationship.weightBps])
    );
    const factionWeights = new Map(
      manifest.relationships
        .filter((relationship) => relationship.sourceType === "faction" && relationship.targetType === "world")
        .map((relationship) => [relationship.sourceId, relationship.weightBps])
    );
    const [zones, factions] = await Promise.all([
      Promise.all(manifest.zones.map(async (zone) => {
        const live = await this.getZone(zone.zoneId);
        return { ...live, slug: zone.sourceId, allocationWeightBps: zoneWeights.get(zone.sourceId) };
      })),
      Promise.all(manifest.factions.map(async (faction) => {
        const live = await this.getFactionMorale(faction.factionId);
        return { ...live, name: faction.name, allocationWeightBps: factionWeights.get(faction.sourceId) };
      })),
    ]);
    return { zones, factions };
  }

  async upgradeToAndCall(params: {
    newImplementation: `0x${string}`;
    data?: `0x${string}`;
    value?: string;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
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
      account: this.account ?? undefined,
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

  async requestLlmToolsChat(params: {
    triggerId: `0x${string}`;
    roles: string[];
    messages: string[];
    mcpServerUrls: string[];
    cooldownSeconds?: number;
    value?: string;
  }): Promise<{ requestId: bigint; txHash: `0x${string}` }> {
    const hash = await this.walletClient.writeContract({
      account: this.account ?? undefined,
      address: this.worldAddress,
      abi: WORLD_INSTANCE_ABI,
      functionName: "requestLlmToolsChat",
      args: [
        params.triggerId,
        params.roles,
        params.messages,
        params.mcpServerUrls,
        BigInt(params.cooldownSeconds ?? 0),
      ],
      value: params.value ? parseEther(params.value) : 0n,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const requestId = extractWorldRequestIdFromLogs(receipt.logs);
    return { requestId, txHash: hash };
  }

  async requestLlmToolsChatAndParse(params: {
    triggerId: `0x${string}`;
    roles: string[];
    messages: string[];
    mcpServerUrls: string[];
    cooldownSeconds?: number;
    value?: string;
  }): Promise<{
    txHash: `0x${string}`;
    transaction: VerifiedTransaction;
    events: DecodedWorldRuntimeEvent[];
    requestIds: string[];
  }> {
    const { txHash, requestId } = await this.requestLlmToolsChat(params);
    const verified = await this.verifyTransaction(txHash);
    const requestIds = [...new Set([
      requestId ? requestId.toString() : "",
      ...verified.events.map((event) => event.requestId).filter((id): id is string => Boolean(id)),
    ].filter(Boolean))];
    return { txHash, transaction: verified.transaction, events: verified.events, requestIds };
  }

  async requestChronicleOnChain(params: {
    triggerId: `0x${string}`;
    rawEvent: string;
    system: string;
    cooldownSeconds?: number;
    value?: string;
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      account: this.account ?? undefined,
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
      account: this.account ?? undefined,
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
      account: this.account ?? undefined,
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
      account: this.account ?? undefined,
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
      account: this.account ?? undefined,
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

  watchRuntimeEvents(callback: (event: WorldEvent) => void): () => void {
    return this.onEvent(callback);
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
