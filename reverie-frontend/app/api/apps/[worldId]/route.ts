import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getDemoWorldState } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { effectiveWorldStatus } from '@/lib/server/live-world';
import type { WorldSummary } from '@/lib/shared/types';

interface Params {
  params: Promise<{ worldId: string }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStringArray(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function builderAgentIds(state: Record<string, unknown>): string[] {
  const builder = objectValue(state.builder);
  const chain = Array.isArray(builder.agentChain) ? builder.agentChain : [];
  return uniqueStringArray(chain.map((step) => {
    const record = objectValue(step);
    return typeof record.agentId === 'string' ? record.agentId : typeof record.id === 'string' ? record.id : '';
  }));
}

function stateZones(value: unknown) {
  return Array.isArray(value)
    ? value.map((zone, index) => {
        const record = objectValue(zone);
        const live = objectValue(record.live);
        const state = objectValue(record.state);
        const weight = Number(record.allocationWeightBps ?? 0);
        const allocation = typeof record.allocationPercent === 'number' ? record.allocationPercent : Number.isFinite(weight) && weight > 0 ? weight / 100 : 0;
        const dangerLevel = Number(live.dangerLevel ?? record.dangerLevel ?? state.dangerLevel ?? allocation);
        return {
          id: typeof record.sourceId === 'string' ? record.sourceId : typeof record.id === 'string' ? record.id : `zone-${index + 1}`,
          compiledId: typeof record.zoneId === 'string' ? record.zoneId : undefined,
          name: typeof live.name === 'string' && live.name ? live.name : typeof record.name === 'string' ? record.name : `Zone ${index + 1}`,
          dangerLevel: Number.isFinite(dangerLevel) ? dangerLevel : allocation,
          controller: typeof live.controllingFaction === 'string' && live.controllingFaction ? live.controllingFaction : typeof record.controller === 'string' ? record.controller : typeof state.controllingFaction === 'string' ? state.controllingFaction : 'Unassigned',
          climate: typeof live.climateState === 'string' && live.climateState ? live.climateState : typeof record.climate === 'string' ? record.climate : typeof state.climate === 'string' ? state.climate : 'Not configured',
          allocationPercent: allocation,
          latestDecision: typeof state.latestDecision === 'string' ? state.latestDecision : undefined,
          entities: stringArray(record.entities),
        };
      })
    : [];
}

function stateFactions(value: unknown) {
  return Array.isArray(value)
    ? value.map((faction, index) => {
        const record = objectValue(faction);
        const live = objectValue(record.live);
        const state = objectValue(record.state);
        const weight = Number(record.allocationWeightBps ?? 0);
        const allocation = typeof record.allocationPercent === 'number' ? record.allocationPercent : Number.isFinite(weight) && weight > 0 ? weight / 100 : 0;
        const moraleDelta = Number(live.moraleDelta ?? state.moraleDelta ?? record.moraleDelta ?? 0);
        const morale = Number(record.morale ?? state.morale ?? allocation);
        return {
          id: typeof record.sourceId === 'string' ? record.sourceId : typeof record.factionId === 'string' ? record.factionId : typeof record.id === 'string' ? record.id : undefined,
          name: typeof record.name === 'string' ? record.name : `Faction ${index + 1}`,
          morale: Number.isFinite(morale) ? morale : allocation,
          moraleDelta: Number.isFinite(moraleDelta) ? moraleDelta : 0,
          narrative: typeof live.narrative === 'string' && live.narrative ? live.narrative : typeof state.narrative === 'string' ? state.narrative : undefined,
          allocationPercent: allocation,
          memberCount: typeof record.memberCount === 'number' ? record.memberCount : 0,
        };
      })
    : [];
}

function formatWorldSummary(world: {
  id: string;
  name: string;
  contract_address: string | null;
  template_id: string | null;
  world_state: unknown;
  status: WorldSummary['status'];
  sttt_balance: number | string;
  created_at: string;
}): WorldSummary {
  const state = objectValue(world.world_state);
  const agents = uniqueStringArray([...stringArray(state.agents), ...builderAgentIds(state)]);
  return {
    id: world.id,
    name: world.name,
    contractAddress: world.contract_address ?? '',
    template: typeof state.templateSlug === 'string' ? state.templateSlug : world.template_id ?? 'Custom',
    templateSlug: typeof state.templateSlug === 'string' ? state.templateSlug : 'custom',
    status: effectiveWorldStatus(world),
    balance: `${world.sttt_balance} STT`,
    activeAgents: agents.length,
    createdAt: world.created_at,
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;

  if (!hasSupabaseAdminEnv()) return NextResponse.json(getDemoWorldState(worldId));

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const data = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId, publicOnly: !userId });
  if (!data) return NextResponse.json({ error: 'World not found' }, { status: 404 });

  const summary = formatWorldSummary(data);
  const state = objectValue(data.world_state);
  const agents = uniqueStringArray([...stringArray(state.agents), ...builderAgentIds(state)]);
  const worldState = { ...state, agents };
  return NextResponse.json({
    ...summary,
    weeklySpend: typeof state.weeklySpend === 'string' ? state.weeklySpend : '0 STT',
    estimatedRunway: typeof state.estimatedRunway === 'string' ? state.estimatedRunway : 'Unknown',
    zones: stateZones(state.zones),
    factions: stateFactions(state.factions),
    lastUpdated: typeof state.lastUpdated === 'string' ? state.lastUpdated : data.created_at,
    activeAgents: agents.length,
    worldState,
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;
  const body = await req.json();

  if (!hasSupabaseAdminEnv()) return NextResponse.json({ world: { ...getDemoWorldState(worldId), ...body }, source: 'demo' });

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 });
  const { data, error } = await supabase
    .from('worlds')
    .update({
      name: body.name,
      description: body.description,
      status: body.status,
      world_state: body.worldState,
      updated_at: new Date().toISOString(),
    })
    .eq('id', world.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'Failed to update world' }, { status: 500 });
  return NextResponse.json({ world: formatWorldSummary(data), worldState: data.world_state });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;

  if (!hasSupabaseAdminEnv()) return NextResponse.json({ success: true, deletedId: worldId, source: 'demo' });

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to resolve user' }, { status: 500 });

  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 });

  const { data: assignedAgents } = await supabase
    .from('agents')
    .select('id,config')
    .eq('owner_id', userId);
  const worldOwnedAgentIds = (assignedAgents ?? []).filter((item) => {
    const config = item.config && typeof item.config === 'object' ? item.config as Record<string, unknown> : {};
    return config.assignedWorldId === worldId || config.assignedWorldId === world.id;
  }).map((agent) => String(agent.id));

  if (worldOwnedAgentIds.length > 0) {
    const { error: agentDeleteError } = await supabase
      .from('agents')
      .delete()
      .eq('owner_id', userId)
      .in('id', worldOwnedAgentIds);
    if (agentDeleteError) {
      return NextResponse.json({ error: 'Failed to delete world agents' }, { status: 500 });
    }
  }

  const { data: sdkAgents } = await supabase
    .from('user_sdk_agents')
    .select('id,default_input')
    .eq('owner_id', userId);
  const assignedSdkPreferenceIds = (sdkAgents ?? []).filter((item) => {
    const defaultInput = item.default_input && typeof item.default_input === 'object' ? item.default_input as Record<string, unknown> : {};
    return defaultInput.assignedWorldId === worldId || defaultInput.assignedWorldId === world.id;
  }).map((sdkAgent) => String(sdkAgent.id));

  if (assignedSdkPreferenceIds.length > 0) {
    const { error: sdkDeleteError } = await supabase
      .from('user_sdk_agents')
      .delete()
      .eq('owner_id', userId)
      .in('id', assignedSdkPreferenceIds);
    if (sdkDeleteError) {
      return NextResponse.json({ error: 'Failed to delete world agent preferences' }, { status: 500 });
    }
  }

  const { error } = await supabase.from('worlds').delete().eq('id', world.id).eq('owner_id', userId);
  if (error) return NextResponse.json({ error: 'Failed to delete world' }, { status: 500 });
  return NextResponse.json({
    success: true,
    deletedId: worldId,
    deletedAgentIds: worldOwnedAgentIds,
    deletedSdkPreferenceIds: assignedSdkPreferenceIds,
  });
}
