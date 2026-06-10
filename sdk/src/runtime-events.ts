import {
  decodeEventLog,
  formatEther,
  type Log,
  type TransactionReceipt,
} from "viem";
import { WORLD_INSTANCE_ABI } from "./abis.js";
import { getAddressUrl, getAgentReceiptUrl, getTransactionUrl } from "./explorer.js";

export type WorldRuntimeEventKind =
  | "TriggerFired"
  | "WorkflowStepRequested"
  | "NativeAgentRequested"
  | "AgentDecisionRequested"
  | "AgentDecisionReceived"
  | "JsonOracleRequested"
  | "JsonOracleReceived"
  | "ChronicleAdded"
  | "ZoneUpdated"
  | "FactionMoraleUpdated"
  | "WorkflowCompleted"
  | "DecisionContinuationMatched"
  | "LifecycleStatusChanged"
  | "ManifestTriggerSubscribed"
  | "ManifestTriggerUnsubscribed"
  | "ManifestConfigured";

export interface DecodedWorldRuntimeEvent {
  kind: WorldRuntimeEventKind;
  transactionHash?: `0x${string}`;
  blockNumber?: string;
  logIndex?: number;
  args: Record<string, string | number | boolean | null>;
  requestId?: string;
  triggerId?: `0x${string}`;
  stepIndex?: number;
  agentKind?: "llm" | "json_api" | "web_parse";
  result?: string;
  receiptUrl?: string;
  transactionUrl?: string;
}

export interface VerifiedTransaction {
  transactionHash: `0x${string}`;
  transactionUrl: string;
  blockNumber: string;
  status: "success" | "failed";
  from: `0x${string}`;
  to: `0x${string}` | null;
  gasUsed: string;
  effectiveGasPrice?: string;
  valueStt?: string;
}

export interface DecodedReactivitySubscriptionEvent {
  kind: "SubscriptionCreated" | "SubscriptionRemoved";
  transactionHash?: `0x${string}`;
  blockNumber?: string;
  logIndex?: number;
  subscriptionId?: string;
  owner?: `0x${string}`;
  handlerContractAddress?: `0x${string}`;
  emitter?: `0x${string}`;
  topic0?: `0x${string}`;
  topic1?: `0x${string}`;
  gasLimit?: string;
}

const REACTIVITY_PRECOMPILE_ABI = [
  {
    type: "event",
    name: "SubscriptionCreated",
    anonymous: false,
    inputs: [
      { name: "subscriptionId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      {
        name: "subscriptionData",
        type: "tuple",
        indexed: false,
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
      },
    ],
  },
  {
    type: "event",
    name: "SubscriptionRemoved",
    anonymous: false,
    inputs: [
      { name: "subscriptionId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

function stringifyArg(value: unknown): string | number | boolean | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function normalizeArgs(args: unknown): Record<string, string | number | boolean | null> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([key, value]) => [key, stringifyArg(value)])
  );
}

function requestIdFromArgs(args: Record<string, string | number | boolean | null>): string | undefined {
  const value = args.requestId;
  return typeof value === "string" && value ? value : undefined;
}

function triggerIdFromArgs(args: Record<string, string | number | boolean | null>): `0x${string}` | undefined {
  const value = args.triggerId;
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? value as `0x${string}` : undefined;
}

function agentKind(value: unknown): DecodedWorldRuntimeEvent["agentKind"] {
  const numeric = typeof value === "bigint" ? Number(value) : Number(value);
  if (numeric === 1) return "json_api";
  if (numeric === 2) return "web_parse";
  return "llm";
}

export function decodeWorldRuntimeLogs(logs: readonly Log[]): DecodedWorldRuntimeEvent[] {
  const decoded: DecodedWorldRuntimeEvent[] = [];
  for (const log of logs) {
    try {
      const event = decodeEventLog({
        abi: WORLD_INSTANCE_ABI,
        data: log.data,
        topics: log.topics,
      });
      const name = event.eventName as string;
      if (!isWorldRuntimeEventKind(name)) continue;
      const args = normalizeArgs(event.args);
      const requestId = requestIdFromArgs(args);
      const triggerId = triggerIdFromArgs(args);
      const stepIndex = typeof args.stepIndex === "string" ? Number(args.stepIndex) : undefined;
      decoded.push({
        kind: name,
        transactionHash: log.transactionHash ?? undefined,
        transactionUrl: log.transactionHash ? getTransactionUrl(log.transactionHash) : undefined,
        blockNumber: log.blockNumber?.toString(),
        logIndex: log.logIndex !== null && log.logIndex !== undefined ? Number(log.logIndex) : undefined,
        args,
        requestId,
        triggerId,
        stepIndex: Number.isFinite(stepIndex) ? stepIndex : undefined,
        agentKind: name === "NativeAgentRequested" ? agentKind(args.agent) : undefined,
        result: typeof args.result === "string" ? args.result : typeof args.description === "string" ? args.description : undefined,
        receiptUrl: requestId ? getAgentReceiptUrl(requestId) : undefined,
      });
    } catch {
      // Receipts may include registry/proxy/platform logs. Ignore non-world events.
    }
  }
  return decoded;
}

export function decodeReactivitySubscriptionLogs(logs: readonly Log[]): DecodedReactivitySubscriptionEvent[] {
  const decoded: DecodedReactivitySubscriptionEvent[] = [];
  for (const log of logs) {
    try {
      const event = decodeEventLog({
        abi: REACTIVITY_PRECOMPILE_ABI,
        data: log.data,
        topics: log.topics,
      });
      const args = event.args as Record<string, unknown>;
      const data = args.subscriptionData && typeof args.subscriptionData === "object"
        ? args.subscriptionData as Record<string, unknown>
        : {};
      const topics = Array.isArray(data.eventTopics) ? data.eventTopics : [];
      decoded.push({
        kind: event.eventName as "SubscriptionCreated" | "SubscriptionRemoved",
        transactionHash: log.transactionHash ?? undefined,
        blockNumber: log.blockNumber?.toString(),
        logIndex: log.logIndex !== null && log.logIndex !== undefined ? Number(log.logIndex) : undefined,
        subscriptionId: typeof args.subscriptionId === "bigint" ? args.subscriptionId.toString() : undefined,
        owner: typeof args.owner === "string" ? args.owner as `0x${string}` : undefined,
        handlerContractAddress: typeof data.handlerContractAddress === "string" ? data.handlerContractAddress as `0x${string}` : undefined,
        emitter: typeof data.emitter === "string" ? data.emitter as `0x${string}` : undefined,
        topic0: typeof topics[0] === "string" ? topics[0] as `0x${string}` : undefined,
        topic1: typeof topics[1] === "string" ? topics[1] as `0x${string}` : undefined,
        gasLimit: typeof data.gasLimit === "bigint" ? data.gasLimit.toString() : undefined,
      });
    } catch {
      // Ignore non-reactivity logs.
    }
  }
  return decoded;
}

export function verifyReceiptSummary(receipt: TransactionReceipt): VerifiedTransaction {
  return {
    transactionHash: receipt.transactionHash,
    transactionUrl: getTransactionUrl(receipt.transactionHash),
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status === "success" ? "success" : "failed",
    from: receipt.from,
    to: receipt.to,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
  };
}

export function worldExplorerLinks(address: `0x${string}`) {
  return {
    address,
    addressUrl: getAddressUrl(address),
  };
}

export function formatStt(value: bigint): string {
  return formatEther(value);
}

function isWorldRuntimeEventKind(value: string): value is WorldRuntimeEventKind {
  return [
    "TriggerFired",
    "WorkflowStepRequested",
    "NativeAgentRequested",
    "AgentDecisionRequested",
    "AgentDecisionReceived",
    "JsonOracleRequested",
    "JsonOracleReceived",
    "ChronicleAdded",
    "ZoneUpdated",
    "FactionMoraleUpdated",
    "WorkflowCompleted",
    "DecisionContinuationMatched",
    "LifecycleStatusChanged",
    "ManifestTriggerSubscribed",
    "ManifestTriggerUnsubscribed",
    "ManifestConfigured",
  ].includes(value);
}
