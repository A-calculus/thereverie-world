import 'server-only';
import { formatEther } from 'viem';
import { objectValue } from '@/lib/server/live-world';
import { agentReceiptUrl, evmTransactionUrl } from '@/lib/shared/explorer-links';
import type { RuntimeTimelineItem } from '@/lib/shared/types';

type SupabaseClientLike = {
  from: (table: string) => unknown;
};

type TableQueryLike = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      order: (column: string, options?: { ascending?: boolean }) => {
        limit: (limit: number) => PromiseLike<{ data: unknown[] | null; error?: unknown }>;
      };
    };
  };
};

type WorldLike = {
  id: string;
  world_state?: unknown;
};

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function timestamp(value: unknown, fallback?: string) {
  const raw = stringValue(value, fallback ?? '');
  if (!raw) return new Date(0).toISOString();
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function statusSeverity(status: string): RuntimeTimelineItem['severity'] {
  const normalized = status.toLowerCase();
  if (['failed', 'error', 'insufficient_budget', 'reverted'].includes(normalized)) return 'error';
  if (['pending', 'submitted', 'compiled'].includes(normalized)) return 'warning';
  if (['success', 'complete', 'active', 'running', 'armed', 'deployed'].includes(normalized)) return 'success';
  return 'info';
}

function transactionCostStt(value: unknown) {
  const tx = objectValue(value);
  const gasUsed = stringValue(tx.gasUsed);
  const effectiveGasPrice = stringValue(tx.effectiveGasPrice);
  if (!gasUsed || !effectiveGasPrice) return 0;
  try {
    return Number(formatEther(BigInt(gasUsed) * BigInt(effectiveGasPrice)));
  } catch {
    return 0;
  }
}

function receiptCostStt(value: unknown): number {
  const receipt = objectValue(value);
  const candidates: unknown[] = [
    receipt.costStt,
    receipt.executionCostStt,
    receipt.totalCostStt,
    receipt.executionCost,
    receipt.totalCost,
    receipt.feeStt,
    objectValue(receipt.cost).stt,
    objectValue(receipt.usage).costStt,
    objectValue(receipt.usage).executionCostStt,
    objectValue(receipt.llmUsage).costStt,
    objectValue(receipt.bandwidthUsage).costStt,
  ];
  return candidates.reduce<number>((sum, item) => sum + numberValue(item, 0), 0);
}

function decodedEventItem(worldId: string, event: Record<string, unknown>, createdAt: string, prefix: string): RuntimeTimelineItem | null {
  const kind = stringValue(event.kind);
  if (!kind) return null;
  const args = objectValue(event.args);
  const requestId = stringValue(event.requestId, stringValue(args.requestId));
  const status = kind.endsWith('Received') || kind === 'WorkflowCompleted' || kind === 'DecisionContinuationMatched' || kind === 'ZoneUpdated' || kind === 'FactionMoraleUpdated' || kind === 'ManifestConfigured'
    ? 'complete'
    : kind.includes('Requested')
      ? 'pending'
      : 'success';
  const result = stringValue(event.result, stringValue(args.result, stringValue(args.description)));
  const transactionHash = stringValue(event.transactionHash);
  return {
    id: `${prefix}:${kind}:${transactionHash || 'no-tx'}:${stringValue(event.logIndex, requestId || createdAt)}`,
    worldId,
    kind,
    status,
    severity: statusSeverity(status),
    createdAt,
    title: kind.replace(/([a-z])([A-Z])/g, '$1 $2'),
    summary: result || JSON.stringify(args),
    transactionHash: transactionHash || undefined,
    transactionUrl: stringValue(event.transactionUrl) || (transactionHash ? evmTransactionUrl(transactionHash) : undefined),
    requestId: requestId || undefined,
    receiptUrl: stringValue(event.receiptUrl) || (requestId ? agentReceiptUrl(requestId) : undefined),
    triggerId: stringValue(event.triggerId, stringValue(args.triggerId)) || undefined,
    stepIndex: typeof event.stepIndex === 'number' ? event.stepIndex : numberValue(args.stepIndex, Number.NaN),
    agentKind: stringValue(event.agentKind) || undefined,
    details: args,
    raw: event,
  };
}

function addItem(items: RuntimeTimelineItem[], item: RuntimeTimelineItem | null | undefined) {
  if (!item) return;
  if (Number.isNaN(item.stepIndex)) delete item.stepIndex;
  items.push(item);
}

function uniqueSorted(items: RuntimeTimelineItem[], limit: number) {
  const byId = new Map<string, RuntimeTimelineItem>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

async function tableRows(supabase: SupabaseClientLike, table: string, worldId: string, limit: number) {
  const query = supabase.from(table) as TableQueryLike;
  const result = await query
    .select('*')
    .eq('world_id', worldId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return arrayValue(result.data);
}

export async function buildRuntimeTimeline(options: {
  supabase: SupabaseClientLike;
  world: WorldLike;
  limit?: number;
}) {
  const limit = options.limit ?? 100;
  const worldId = options.world.id;
  const [
    eventRows,
    deploymentRows,
    subscriptionRows,
    runRows,
    requestRows,
    balanceRows,
  ] = await Promise.all([
    tableRows(options.supabase, 'events', worldId, limit),
    tableRows(options.supabase, 'world_deployments', worldId, limit),
    tableRows(options.supabase, 'world_reactivity_subscriptions', worldId, limit),
    tableRows(options.supabase, 'world_runtime_runs', worldId, limit),
    tableRows(options.supabase, 'world_agent_requests', worldId, limit),
    tableRows(options.supabase, 'world_balance_snapshots', worldId, limit),
  ]);

  const items: RuntimeTimelineItem[] = [];

  for (const row of deploymentRows) {
    const createdAt = timestamp(row.updated_at, timestamp(row.created_at));
    addItem(items, {
      id: `deployment:${stringValue(row.id)}`,
      worldId,
      kind: 'deployment',
      status: stringValue(row.status, stringValue(row.tx_status, 'deployed')),
      severity: statusSeverity(stringValue(row.tx_status, 'success')),
      createdAt,
      title: 'World deployed',
      summary: `Manifest ${stringValue(row.manifest_hash, 'unknown')} configured for ${stringValue(row.contract_address, 'world contract')}.`,
      transactionHash: stringValue(row.deploy_tx_hash) || undefined,
      transactionUrl: stringValue(row.explorer_url) || (stringValue(row.deploy_tx_hash) ? evmTransactionUrl(stringValue(row.deploy_tx_hash)) : undefined),
      details: { manifestHash: row.manifest_hash, contractAddress: row.contract_address, configureTxHash: row.configure_tx_hash },
      raw: row,
    });
    for (const event of arrayValue(row.decoded_events)) addItem(items, decodedEventItem(worldId, event, createdAt, `deployment:${stringValue(row.id)}`));
  }

  for (const row of subscriptionRows) {
    const createdAt = timestamp(row.updated_at, timestamp(row.created_at));
    const status = stringValue(row.status, 'pending');
    addItem(items, {
      id: `subscription:${stringValue(row.id)}`,
      worldId,
      kind: 'subscription',
      status,
      severity: statusSeverity(status),
      createdAt,
      title: status === 'compiled' ? 'Trigger compiled' : 'Trigger subscription',
      summary: status === 'compiled'
        ? 'Trigger is compiled in the manifest but has not been subscribed on-chain.'
        : `Trigger ${stringValue(row.trigger_id, 'unknown')} subscribed on-chain.`,
      transactionHash: stringValue(row.subscribe_tx_hash) || undefined,
      transactionUrl: stringValue(row.explorer_url) || (stringValue(row.subscribe_tx_hash) ? evmTransactionUrl(stringValue(row.subscribe_tx_hash)) : undefined),
      triggerId: stringValue(row.trigger_id) || undefined,
      details: { subscriptionId: row.subscription_id, emitter: row.emitter_address, topic0: row.topic0, gasLimit: row.gas_limit },
      raw: row,
    });
    for (const event of arrayValue(row.decoded_events)) addItem(items, decodedEventItem(worldId, event, createdAt, `subscription:${stringValue(row.id)}`));
  }

  for (const row of runRows) {
    const createdAt = timestamp(row.created_at);
    const status = stringValue(row.status, 'pending');
    const summary = objectValue(row.summary);
    addItem(items, {
      id: `run:${stringValue(row.id)}`,
      worldId,
      kind: 'runtime_run',
      status,
      severity: statusSeverity(status),
      createdAt,
      title: 'Runtime run',
      summary: stringValue(summary.finalResult, `Trigger ${stringValue(row.trigger_id, 'unknown')} run ${status}.`),
      transactionHash: stringValue(row.transaction_hash) || undefined,
      transactionUrl: stringValue(row.explorer_url) || (stringValue(row.transaction_hash) ? evmTransactionUrl(stringValue(row.transaction_hash)) : undefined),
      triggerId: stringValue(row.trigger_id) || undefined,
      details: summary,
      raw: row,
    });
    for (const event of arrayValue(row.decoded_events)) addItem(items, decodedEventItem(worldId, event, createdAt, `run:${stringValue(row.id)}`));
  }

  for (const row of requestRows) {
    const createdAt = timestamp(row.created_at);
    const result = objectValue(row.result);
    const receiptDetails = objectValue(result.receiptDetails);
    const status = stringValue(receiptDetails.status, stringValue(row.status, stringValue(row.callback_status, 'pending')));
    const errorMessage = stringValue(receiptDetails.errorMessage);
    addItem(items, {
      id: `request:${stringValue(row.request_id)}`,
      worldId,
      kind: 'agent_request',
      status,
      severity: statusSeverity(status),
      createdAt,
      title: `${stringValue(row.agent_kind, 'Native agent')} request`,
      summary: errorMessage || stringValue(result.output, `Request ${stringValue(row.request_id, 'unknown')} is ${status}.`),
      transactionHash: stringValue(row.transaction_hash) || undefined,
      transactionUrl: stringValue(row.explorer_url) || (stringValue(row.transaction_hash) ? evmTransactionUrl(stringValue(row.transaction_hash)) : undefined),
      requestId: stringValue(row.request_id) || undefined,
      receiptUrl: stringValue(row.receipt_url) || (stringValue(row.request_id) ? agentReceiptUrl(stringValue(row.request_id)) : undefined),
      triggerId: stringValue(row.trigger_id) || undefined,
      stepIndex: numberValue(row.step_index, Number.NaN),
      agentKind: stringValue(row.agent_kind) || undefined,
      details: { result, receiptDetails, callbackStatus: row.callback_status, txStatus: row.tx_status },
      raw: row,
      costStt: receiptCostStt(receiptDetails),
    });
    for (const event of arrayValue(row.decoded_events)) addItem(items, decodedEventItem(worldId, event, createdAt, `request:${stringValue(row.request_id)}`));
  }

  for (const row of balanceRows) {
    const createdAt = timestamp(row.created_at);
    const transactionHash = stringValue(row.transaction_hash);
    addItem(items, {
      id: `balance:${stringValue(row.id)}`,
      worldId,
      kind: 'balance_snapshot',
      status: 'success',
      severity: 'success',
      createdAt,
      title: 'Balance refreshed',
      summary: `World balance is ${numberValue(row.balance_stt).toFixed(4)} STT.`,
      transactionHash: transactionHash || undefined,
      transactionUrl: transactionHash ? evmTransactionUrl(transactionHash) : undefined,
      details: { balanceWei: row.balance_wei, balanceStt: row.balance_stt, source: row.source },
      raw: row,
    });
  }

  for (const row of eventRows) {
    const createdAt = timestamp(row.created_at);
    const result = objectValue(row.result);
    const transactionHash = stringValue(row.transaction_hash);
    addItem(items, {
      id: `event:${stringValue(row.id)}`,
      worldId,
      kind: stringValue(row.event_type, stringValue(result.type, 'world_event')),
      status: stringValue(row.consensus_status, 'success'),
      severity: statusSeverity(stringValue(row.consensus_status, 'success')),
      createdAt,
      title: stringValue(result.title, stringValue(row.event_type, 'World event')),
      summary: stringValue(result.description, JSON.stringify(result)),
      transactionHash: transactionHash || undefined,
      transactionUrl: stringValue(result.transactionUrl) || (transactionHash ? evmTransactionUrl(transactionHash) : undefined),
      requestId: stringValue(row.request_id) || undefined,
      receiptUrl: stringValue(row.request_id) ? agentReceiptUrl(stringValue(row.request_id)) : undefined,
      details: result,
      raw: row,
      costStt: numberValue(row.cost_sttt, 0),
    });
  }

  const state = objectValue(options.world.world_state);
  const live = objectValue(state.live);
  for (const txKey of ['deployVerification', 'configureVerification', 'lastArmTransaction', 'lastManualTrigger', 'lastStopTransaction']) {
    const tx = objectValue(live[txKey]);
    const transactionHash = stringValue(tx.transactionHash);
    if (!transactionHash) continue;
    const createdAt = timestamp(tx.createdAt ?? tx.blockTimestamp ?? state.lastUpdated);
    addItem(items, {
      id: `live-tx:${txKey}:${transactionHash}`,
      worldId,
      kind: txKey,
      status: stringValue(tx.status, 'success'),
      severity: statusSeverity(stringValue(tx.status, 'success')),
      createdAt,
      title: txKey.replace(/([a-z])([A-Z])/g, '$1 $2'),
      summary: `Confirmed transaction ${transactionHash}.`,
      transactionHash,
      transactionUrl: stringValue(tx.transactionUrl) || evmTransactionUrl(transactionHash),
      details: tx,
      raw: tx,
      costStt: transactionCostStt(tx),
    });
  }

  const timeline = uniqueSorted(items, limit);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const netSttSpent7d = timeline.reduce((sum, item) => (
    new Date(item.createdAt).getTime() >= sevenDaysAgo ? sum + (item.costStt ?? 0) : sum
  ), 0);
  const activeSubscriptionCount = subscriptionRows.filter((row) => (
    ['active', 'subscribed'].includes(stringValue(row.status)) &&
    (stringValue(row.subscription_id) || stringValue(row.subscribe_tx_hash))
  )).length;
  const requestStatusCounts = requestRows.reduce<Record<string, number>>((counts, row) => {
    const result = objectValue(row.result);
    const receiptDetails = objectValue(result.receiptDetails);
    const status = stringValue(receiptDetails.status, stringValue(row.status, stringValue(row.callback_status, 'pending')));
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    timeline,
    aggregates: {
      activeSubscriptionCount,
      requestStatusCounts,
      receiptErrorCount: requestRows.filter((row) => ['failed', 'error', 'insufficient_budget'].includes(stringValue(objectValue(objectValue(row.result).receiptDetails).status, stringValue(row.status)))).length,
      netSttSpent7d,
    },
  };
}
