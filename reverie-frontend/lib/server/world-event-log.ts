import 'server-only';
import type { EventLog, WorldRuntimeEvent, WorldRuntimeRun } from '@/lib/shared/types';

type SupabaseLike = {
  from: (table: string) => {
    insert: (value: Record<string, unknown> | Record<string, unknown>[]) => PromiseLike<{ error?: unknown }>;
  };
};

type DbEvent = {
  id: string;
  world_id: string;
  event_type: string | null;
  request_id: string | null;
  transaction_hash: string | null;
  result: unknown;
  cost_sttt: number | string | null;
  created_at: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function eventType(value: unknown): EventLog['type'] {
  if (value === 'agent_decision' || value === 'chronicle_entry' || value === 'zone_updated' || value === 'trigger_fired') return value;
  if (value === 'manual_action' || value === 'runtime_run') return 'trigger_fired';
  return 'chronicle_entry';
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function formatDbWorldEvent(row: DbEvent): EventLog {
  const result = objectValue(row.result);
  return {
    id: row.id,
    worldId: row.world_id,
    type: eventType(result.type ?? row.event_type),
    title: stringValue(result.title, stringValue(row.event_type, 'World event')),
    description: stringValue(result.description, JSON.stringify(result, null, 2)),
    timestamp: stringValue(result.timestamp, row.created_at),
    agentId: typeof result.agentId === 'string' ? result.agentId : undefined,
    cost: row.cost_sttt !== null && row.cost_sttt !== undefined ? `${row.cost_sttt} STT` : typeof result.cost === 'string' ? result.cost : undefined,
    receiptId: stringValue(result.receiptId, row.request_id ?? '') || undefined,
    transactionHash: stringValue(result.transactionHash, row.transaction_hash ?? '') || undefined,
  };
}

export async function insertWorldEvent(supabase: SupabaseLike, event: {
  worldId: string;
  type: EventLog['type'] | 'manual_action' | 'runtime_run';
  title: string;
  description: string;
  receiptId?: string | null;
  transactionHash?: string | null;
  costSttt?: number | null;
  result?: Record<string, unknown>;
  validatorCount?: number;
}) {
  await supabase.from('events').insert({
    world_id: event.worldId,
    event_type: event.type,
    request_id: event.receiptId ?? null,
    transaction_hash: event.transactionHash ?? null,
    result: {
      type: event.type,
      title: event.title,
      description: event.description,
      timestamp: new Date().toISOString(),
      receiptId: event.receiptId ?? undefined,
      transactionHash: event.transactionHash ?? undefined,
      ...(event.result ?? {}),
    },
    cost_sttt: event.costSttt ?? null,
    consensus_status: 'agreed',
    validator_count: event.validatorCount ?? 0,
  });
}

export async function insertRuntimeRunEvents(supabase: SupabaseLike, options: {
  worldId: string;
  run: WorldRuntimeRun;
  costSttt?: number | null;
}) {
  const rows: Record<string, unknown>[] = [];
  for (const runtimeEvent of options.run.events) {
    rows.push(runtimeEventRow(options.worldId, runtimeEvent, {
      costSttt: options.costSttt,
      validatorCount: options.run.receipts.length,
    }));
  }
  for (const agent of options.run.agentResponses) {
    rows.push({
      world_id: options.worldId,
      agent_id: null,
      event_type: 'agent_decision',
      request_id: agent.receiptUrl ?? null,
      transaction_hash: null,
      result: {
        type: 'agent_decision',
        title: `${agent.name} completed`,
        description: typeof agent.response === 'string' ? agent.response : JSON.stringify(agent.response ?? agent.request ?? 'Agent step completed.'),
        timestamp: new Date().toISOString(),
        agentId: agent.id,
        receiptId: agent.receiptUrl,
        input: agent.request,
        output: agent.response,
      },
      cost_sttt: options.costSttt ? options.costSttt / Math.max(1, options.run.agentResponses.length) : null,
      consensus_status: 'agreed',
      validator_count: options.run.receipts.length,
    });
  }
  if (rows.length > 0) await supabase.from('events').insert(rows);
}

function runtimeEventRow(worldId: string, runtimeEvent: WorldRuntimeEvent, options: { costSttt?: number | null; validatorCount: number }) {
  return {
    world_id: worldId,
    event_type: eventType(runtimeEvent.type),
    request_id: runtimeEvent.receiptId ?? null,
    transaction_hash: null,
    result: runtimeEvent,
    cost_sttt: options.costSttt ?? null,
    consensus_status: 'agreed',
    validator_count: options.validatorCount,
  };
}
