import 'server-only';
import { createPublicClient, decodeEventLog, formatEther, http, type Log } from 'viem';
import { WORLD_INSTANCE_ABI, decodeReactivitySubscriptionLogs, somniaTestnet } from '@worldframe/sdk';
import { agentReceiptUrl, evmAddressUrl, evmTransactionUrl } from '@/lib/shared/explorer-links';

export interface RuntimeDecodedEvent {
  kind: string;
  transactionHash?: string;
  transactionUrl?: string;
  blockNumber?: string;
  logIndex?: number;
  args: Record<string, string | number | boolean | null>;
  requestId?: string;
  triggerId?: string;
  stepIndex?: number;
  agentKind?: 'llm' | 'json_api' | 'web_parse';
  result?: string;
  receiptUrl?: string;
}

export interface RuntimeVerifiedTransaction {
  transactionHash: string;
  transactionUrl: string;
  blockNumber: string;
  status: 'success' | 'failed';
  from: string;
  to: string | null;
  gasUsed: string;
  effectiveGasPrice?: string;
}

export const liveRuntimeClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(process.env.NEXT_PUBLIC_SOMNIA_TESTNET_RPC || 'https://api.infra.testnet.somnia.network'),
});

function stringArg(value: unknown): string | number | boolean | null {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function normalizeArgs(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, arg]) => [key, stringArg(arg)]));
}

function agentKind(value: unknown): RuntimeDecodedEvent['agentKind'] {
  const numeric = Number(value);
  if (numeric === 1) return 'json_api';
  if (numeric === 2) return 'web_parse';
  return 'llm';
}

export function decodeRuntimeLogs(logs: readonly Log[]): RuntimeDecodedEvent[] {
  const decoded: RuntimeDecodedEvent[] = [];
  for (const log of logs) {
    try {
      const event = decodeEventLog({ abi: WORLD_INSTANCE_ABI, data: log.data, topics: log.topics });
      const args = normalizeArgs(event.args);
      const requestId = typeof args.requestId === 'string' && args.requestId ? args.requestId : undefined;
      decoded.push({
        kind: event.eventName,
        transactionHash: log.transactionHash ?? undefined,
        transactionUrl: log.transactionHash ? evmTransactionUrl(log.transactionHash) : undefined,
        blockNumber: log.blockNumber?.toString(),
        logIndex: log.logIndex !== null && log.logIndex !== undefined ? Number(log.logIndex) : undefined,
        args,
        requestId,
        triggerId: typeof args.triggerId === 'string' ? args.triggerId : undefined,
        stepIndex: typeof args.stepIndex === 'string' ? Number(args.stepIndex) : undefined,
        agentKind: event.eventName === 'NativeAgentRequested' ? agentKind(args.agent) : undefined,
        result: typeof args.result === 'string' ? args.result : typeof args.description === 'string' ? args.description : undefined,
        receiptUrl: requestId ? agentReceiptUrl(requestId) : undefined,
      });
    } catch {
      // Receipts include registry/proxy/platform logs. Ignore non-world events.
    }
  }
  return decoded;
}

export async function verifyRuntimeTransaction(txHash: string): Promise<{
  transaction: RuntimeVerifiedTransaction;
  events: RuntimeDecodedEvent[];
  reactivityEvents: ReturnType<typeof decodeReactivitySubscriptionLogs>;
}> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash.');
  const receipt = await liveRuntimeClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
  return {
    transaction: {
      transactionHash: receipt.transactionHash,
      transactionUrl: evmTransactionUrl(receipt.transactionHash),
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status === 'success' ? 'success' : 'failed',
      from: receipt.from,
      to: receipt.to,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
    },
    events: decodeRuntimeLogs(receipt.logs),
    reactivityEvents: decodeReactivitySubscriptionLogs(receipt.logs),
  };
}

export async function getVerifiedWorldBalance(address: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid world address.');
  const balance = await liveRuntimeClient.getBalance({ address: address as `0x${string}` });
  return { balanceWei: balance.toString(), balanceStt: formatEther(balance) };
}

export async function verifyWorldContract(address: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid world address.');
  const code = await liveRuntimeClient.getCode({ address: address as `0x${string}` });
  return {
    address,
    addressUrl: evmAddressUrl(address),
    hasCode: Boolean(code && code !== '0x'),
  };
}

export async function getLatestRuntimeBlock() {
  return liveRuntimeClient.getBlockNumber();
}

export async function getRuntimeEvents(params: {
  address: string;
  fromBlock?: string | number | bigint;
  toBlock?: string | number | bigint;
}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.address)) throw new Error('Invalid world address.');
  const logs = await liveRuntimeClient.getLogs({
    address: params.address as `0x${string}`,
    fromBlock: params.fromBlock === undefined ? undefined : BigInt(params.fromBlock),
    toBlock: params.toBlock === undefined ? undefined : BigInt(params.toBlock),
  });
  return decodeRuntimeLogs(logs);
}

function envNumber(key: string, fallback: number) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function getRuntimeEventScan(params: {
  address: string;
  fromBlock?: string | number | bigint;
  toBlock?: string | number | bigint;
  maxChunks?: number;
}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.address)) throw new Error('Invalid world address.');
  const latest = params.toBlock === undefined
    ? await liveRuntimeClient.getBlockNumber()
    : BigInt(params.toBlock);
  const chunkSize = BigInt(Math.min(envNumber('NEXT_PUBLIC_REVERIE_RECONCILE_BLOCK_CHUNK_SIZE', 1000), 1000));
  const maxChunks = Math.max(1, params.maxChunks ?? 20);
  let cursor = params.fromBlock === undefined ? latest > chunkSize ? latest - chunkSize + BigInt(1) : BigInt(0) : BigInt(params.fromBlock);
  if (cursor < BigInt(0)) cursor = BigInt(0);
  const events: RuntimeDecodedEvent[] = [];
  let scannedTo = cursor - BigInt(1);
  let chunks = 0;
  while (cursor <= latest && chunks < maxChunks) {
    const end = cursor + chunkSize - BigInt(1) > latest ? latest : cursor + chunkSize - BigInt(1);
    const logs = await liveRuntimeClient.getLogs({
      address: params.address as `0x${string}`,
      fromBlock: cursor,
      toBlock: end,
    });
    events.push(...decodeRuntimeLogs(logs));
    scannedTo = end;
    cursor = end + BigInt(1);
    chunks += 1;
  }
  return {
    events,
    fromBlock: params.fromBlock === undefined ? undefined : BigInt(params.fromBlock).toString(),
    scannedToBlock: scannedTo >= BigInt(0) ? scannedTo.toString() : undefined,
    nextFromBlock: cursor <= latest ? cursor.toString() : undefined,
    latestBlock: latest.toString(),
    complete: cursor > latest,
    chunks,
    chunkSize: chunkSize.toString(),
  };
}

export async function hydrateCompiledManifestState(params: {
  address: string;
  manifest: {
    zones?: Array<{ sourceId?: string; zoneId?: string; name?: string }>;
    factions?: Array<{ sourceId?: string; factionId?: string; name?: string }>;
    relationships?: Array<{ sourceId?: string; sourceType?: string; targetType?: string; weightBps?: string | number | bigint }>;
  };
}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.address)) throw new Error('Invalid world address.');
  const zoneWeights = new Map(
    (params.manifest.relationships ?? [])
      .filter((relationship) => relationship.sourceType === 'zone' && relationship.targetType === 'world')
      .map((relationship) => [relationship.sourceId, relationship.weightBps])
  );
  const factionWeights = new Map(
    (params.manifest.relationships ?? [])
      .filter((relationship) => relationship.sourceType === 'faction' && relationship.targetType === 'world')
      .map((relationship) => [relationship.sourceId, relationship.weightBps])
  );
  const zones = await Promise.all((params.manifest.zones ?? []).map(async (zone) => {
    if (!zone.zoneId || !/^0x[0-9a-fA-F]{64}$/.test(zone.zoneId)) return { ...zone, live: null };
    const result = await liveRuntimeClient.readContract({
      address: params.address as `0x${string}`,
      abi: WORLD_INSTANCE_ABI,
      functionName: 'zones',
      args: [zone.zoneId as `0x${string}`],
    }).catch(() => null);
    const [name, dangerLevel, controllingFaction, climateState] = Array.isArray(result) ? result : [];
    return {
      ...zone,
      allocationWeightBps: zoneWeights.get(zone.sourceId),
      live: result ? {
        name,
        dangerLevel: typeof dangerLevel === 'bigint' ? dangerLevel.toString() : String(dangerLevel ?? '0'),
        controllingFaction,
        climateState,
      } : null,
    };
  }));
  const factions = await Promise.all((params.manifest.factions ?? []).map(async (faction) => {
    if (!faction.factionId) return { ...faction, live: null };
    const result = await liveRuntimeClient.readContract({
      address: params.address as `0x${string}`,
      abi: WORLD_INSTANCE_ABI,
      functionName: 'factionMorale',
      args: [faction.factionId],
    }).catch(() => null);
    const [moraleDelta, narrative, updatedAt] = Array.isArray(result) ? result : [];
    return {
      ...faction,
      allocationWeightBps: factionWeights.get(faction.sourceId),
      live: result ? {
        moraleDelta: typeof moraleDelta === 'bigint' ? moraleDelta.toString() : String(moraleDelta ?? '0'),
        narrative,
        updatedAt: typeof updatedAt === 'bigint' ? updatedAt.toString() : String(updatedAt ?? '0'),
      } : null,
    };
  }));
  return { zones, factions };
}
