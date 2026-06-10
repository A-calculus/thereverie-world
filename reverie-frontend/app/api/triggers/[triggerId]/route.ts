import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { demoTriggers } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { isValidCronExpression } from '@/lib/shared/world-runtime/trigger-flow';
import type { ExecutionLane, FeedType, TriggerOutputMapping, TriggerSourceConfig, TriggerSummary, TriggerType, TriggerTypeConfig } from '@/lib/shared/types';

interface Params {
  params: Promise<{ triggerId: string }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function objectArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((entry): entry is T => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))) : [];
}

function pointValue(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && typeof point.y === 'number' ? { x: point.x, y: point.y } : undefined;
}

function formatTrigger(trigger: Record<string, unknown>): TriggerSummary {
  const condition = objectValue(trigger.condition);
  const feedConfig = objectValue(trigger.feed_config);
  return {
    id: String(trigger.id),
    worldId: String(trigger.world_id),
    name: String(condition.name ?? feedConfig.name ?? 'Trigger'),
    feedType: String(trigger.feed_type ?? 'weather') as FeedType,
    triggerType: String(condition.triggerType ?? 'data_condition') as TriggerType,
    conditionLabel: String(condition.label ?? 'IF condition is true'),
    agentName: String(condition.agentName ?? 'Agent Chain'),
    executionLane: String(trigger.execution_lane ?? 'sdk') as ExecutionLane,
    cooldownMs: Number(trigger.cooldown_ms ?? 0),
    isActive: Boolean(trigger.is_active),
    lastFiredAt: typeof condition.lastFiredAt === 'string' ? condition.lastFiredAt : null,
    graphNodeId: typeof condition.graphNodeId === 'string' ? condition.graphNodeId : undefined,
    chain: stringArray(condition.chain),
    inputParser: typeof condition.inputParser === 'string' ? condition.inputParser : '',
    isStartTrigger: Boolean(condition.isStartTrigger),
    graphPosition: pointValue(condition.graphPosition),
    sourceConfig: objectValue(condition.sourceConfig) as unknown as TriggerSourceConfig,
    typeConfig: objectValue(condition.typeConfig) as TriggerTypeConfig,
    outputMapping: objectArray<TriggerOutputMapping>(condition.outputMapping),
    nextTriggerIds: stringArray(condition.nextTriggerIds),
  };
}

function coarseFeedType(body: Record<string, unknown>, sourceConfig: TriggerSourceConfig, fallback: unknown): FeedType {
  if (typeof body.feedType === 'string') return body.feedType as FeedType;
  if (sourceConfig.kind === 'schedule_time') return 'time';
  if (sourceConfig.kind === 'data_source') return 'web_scrape';
  return String(fallback ?? 'time') as FeedType;
}

function validateTriggerConfig(triggerType: TriggerType, typeConfig: TriggerTypeConfig) {
  if (triggerType === 'scheduled') {
    const cronExpression = typeConfig.cronExpression ?? '';
    if (!isValidCronExpression(cronExpression)) return 'Scheduled triggers require a valid 5-field cron expression.';
  }
  return null;
}

function joinedOwnerId(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value[0] as { owner_id?: unknown } | undefined;
    return typeof first?.owner_id === 'string' ? first.owner_id : null;
  }
  if (value && typeof value === 'object') {
    const ownerId = (value as { owner_id?: unknown }).owner_id;
    return typeof ownerId === 'string' ? ownerId : null;
  }
  return null;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { triggerId } = await params;
  const body = await req.json();
  if (hasSupabaseAdminEnv()) {
    const supabase = createAdminSupabaseClient();
    const userId = await ensureSupabaseUser(session);
    const { data: existing } = await supabase.from('triggers').select('*,worlds!inner(owner_id)').eq('id', triggerId).maybeSingle();
    if (!existing || !userId || joinedOwnerId(existing.worlds) !== userId) return NextResponse.json({ error: 'Trigger not found' }, { status: 404 });
    const condition = existing.condition && typeof existing.condition === 'object' ? existing.condition as Record<string, unknown> : {};
    const bodyCondition = objectValue(body.condition);
    const triggerType = (body.triggerType ?? bodyCondition.triggerType ?? condition.triggerType ?? 'data_condition') as TriggerType;
    const sourceConfig = objectValue(body.sourceConfig ?? bodyCondition.sourceConfig ?? condition.sourceConfig) as unknown as TriggerSourceConfig;
    const typeConfig = objectValue(body.typeConfig ?? bodyCondition.typeConfig ?? condition.typeConfig) as TriggerTypeConfig;
    const validationError = validateTriggerConfig(triggerType, typeConfig);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const update = {
      feed_type: coarseFeedType(body, sourceConfig, existing.feed_type),
      feed_config: body.feedConfig ?? existing.feed_config,
      condition: {
        ...condition,
        ...bodyCondition,
        name: body.name ?? condition.name,
        label: body.conditionLabel ?? condition.label,
        triggerType,
        agentName: body.agentName ?? condition.agentName,
        graphNodeId: body.graphNodeId ?? condition.graphNodeId,
        chain: body.chain ?? condition.chain,
        inputParser: typeof body.inputParser === 'string' ? body.inputParser : bodyCondition.inputParser ?? condition.inputParser,
        isStartTrigger: typeof body.isStartTrigger === 'boolean' ? body.isStartTrigger : Boolean(bodyCondition.isStartTrigger ?? condition.isStartTrigger),
        sourceConfig,
        typeConfig,
        outputMapping: body.outputMapping ?? bodyCondition.outputMapping ?? condition.outputMapping ?? [],
        nextTriggerIds: body.nextTriggerIds ?? bodyCondition.nextTriggerIds ?? condition.nextTriggerIds ?? [],
      },
      execution_lane: body.executionLane ?? existing.execution_lane,
      cooldown_ms: body.cooldownMs ?? existing.cooldown_ms,
      is_active: body.isActive ?? existing.is_active,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('triggers').update(update).eq('id', triggerId).select().single();
    if (error) return NextResponse.json({ error: 'Failed to update trigger' }, { status: 500 });
    return NextResponse.json({ trigger: formatTrigger(data), source: 'database' });
  }
  const existing = demoTriggers.find((trigger) => trigger.id === triggerId) ?? demoTriggers[0];
  return NextResponse.json({ trigger: { ...existing, ...body, id: triggerId, sourceConfig: body.sourceConfig ?? {}, typeConfig: body.typeConfig ?? {}, outputMapping: body.outputMapping ?? [], nextTriggerIds: body.nextTriggerIds ?? [] }, source: 'demo' });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { triggerId } = await params;
  if (hasSupabaseAdminEnv()) {
    const supabase = createAdminSupabaseClient();
    const userId = await ensureSupabaseUser(session);
    const { data: existing } = await supabase.from('triggers').select('id,worlds!inner(owner_id)').eq('id', triggerId).maybeSingle();
    if (!existing || !userId || joinedOwnerId(existing.worlds) !== userId) return NextResponse.json({ error: 'Trigger not found' }, { status: 404 });
    const { error } = await supabase.from('triggers').delete().eq('id', triggerId);
    if (error) return NextResponse.json({ error: 'Failed to delete trigger' }, { status: 500 });
    return NextResponse.json({ success: true, deletedId: triggerId });
  }
  return NextResponse.json({ success: true, deletedId: triggerId, source: 'demo' });
}
