import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { demoTriggers } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { isValidCronExpression } from '@/lib/shared/world-runtime/trigger-flow';
import type { ExecutionLane, FeedType, TriggerOutputMapping, TriggerSourceConfig, TriggerSummary, TriggerType, TriggerTypeConfig } from '@/lib/shared/types';

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

function coarseFeedType(body: Record<string, unknown>, sourceConfig: TriggerSourceConfig): FeedType {
  if (typeof body.feedType === 'string') return body.feedType as FeedType;
  if (sourceConfig.kind === 'schedule_time') return 'time';
  if (sourceConfig.kind === 'data_source') return 'web_scrape';
  return 'time';
}

function validateTriggerConfig(triggerType: TriggerType, typeConfig: TriggerTypeConfig) {
  if (triggerType === 'scheduled') {
    const cronExpression = typeConfig.cronExpression ?? '';
    if (!isValidCronExpression(cronExpression)) return 'Scheduled triggers require a valid 5-field cron expression.';
  }
  return null;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const worldId = searchParams.get('worldId');
  if (hasSupabaseAdminEnv()) {
    const supabase = createAdminSupabaseClient();
    const userId = await ensureSupabaseUser(session);
    let query = supabase.from('triggers').select('*').order('created_at', { ascending: false });
    if (worldId) {
      const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
      if (!world) return NextResponse.json({ triggers: [], source: 'database' });
      query = query.eq('world_id', world.id);
    }
    const { data, error } = await query;
    if (!error) return NextResponse.json({ triggers: (data ?? []).map((trigger) => formatTrigger(trigger)), source: 'database' });
  }
  const triggers = worldId
    ? (worldId === 'glitchwoods' ? demoTriggers.filter((trigger) => trigger.worldId === worldId) : [])
    : demoTriggers;
  return NextResponse.json({ triggers, source: 'demo' });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  if (hasSupabaseAdminEnv()) {
    const supabase = createAdminSupabaseClient();
    const userId = await ensureSupabaseUser(session);
    const worldId = body.worldId;
    if (!userId || !worldId) return NextResponse.json({ error: 'worldId is required' }, { status: 400 });
    const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
    if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 });

    const condition = objectValue(body.condition);
    const triggerType = (body.triggerType ?? condition.triggerType ?? 'data_condition') as TriggerType;
    const sourceConfig = objectValue(body.sourceConfig ?? condition.sourceConfig) as unknown as TriggerSourceConfig;
    const typeConfig = objectValue(body.typeConfig ?? condition.typeConfig) as TriggerTypeConfig;
    const validationError = validateTriggerConfig(triggerType, typeConfig);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const payload = {
      world_id: world.id,
      feed_type: coarseFeedType(body, sourceConfig),
      feed_config: body.feedConfig ?? { name: body.name ?? 'New Trigger' },
      condition: {
        ...condition,
        name: body.name ?? 'New Trigger',
        label: body.conditionLabel ?? 'IF condition is true',
        triggerType,
        agentName: body.agentName ?? 'Agent Chain',
        graphNodeId: body.graphNodeId ?? `trigger:${body.id ?? 'new'}`,
        chain: body.chain ?? [],
        inputParser: typeof body.inputParser === 'string' ? body.inputParser : condition.inputParser ?? '',
        isStartTrigger: Boolean(body.isStartTrigger ?? condition.isStartTrigger),
        sourceConfig,
        typeConfig,
        outputMapping: body.outputMapping ?? condition.outputMapping ?? [],
        nextTriggerIds: body.nextTriggerIds ?? condition.nextTriggerIds ?? [],
      },
      execution_lane: body.executionLane ?? 'sdk',
      cooldown_ms: body.cooldownMs ?? 300_000,
      is_active: body.isActive ?? true,
    };
    const { data, error } = await supabase.from('triggers').insert(payload).select().single();
    if (error) return NextResponse.json({ error: 'Failed to save trigger' }, { status: 500 });
    return NextResponse.json({ trigger: formatTrigger(data), source: 'database' }, { status: 201 });
  }
  return NextResponse.json({
    trigger: {
      id: body.id ?? `trigger-${Date.now()}`,
      worldId: body.worldId ?? 'glitchwoods',
      name: body.name ?? 'New Trigger',
      feedType: body.feedType ?? 'weather',
      conditionLabel: body.conditionLabel ?? 'IF condition is true',
      agentName: body.agentName ?? 'Chronicle Agent',
      executionLane: body.executionLane ?? 'sdk',
      cooldownMs: body.cooldownMs ?? 300_000,
      isActive: body.isActive ?? true,
      lastFiredAt: null,
      graphNodeId: body.graphNodeId,
      chain: body.chain ?? [],
      inputParser: body.inputParser ?? '',
      isStartTrigger: Boolean(body.isStartTrigger),
      sourceConfig: body.sourceConfig ?? {},
      typeConfig: body.typeConfig ?? {},
      outputMapping: body.outputMapping ?? [],
      nextTriggerIds: body.nextTriggerIds ?? [],
    },
    source: 'demo',
  }, { status: 201 });
}
