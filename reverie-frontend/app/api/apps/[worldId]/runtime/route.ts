import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { demoTriggers, getDemoWorldState } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { effectiveWorldStatus } from '@/lib/server/live-world';
import { createGenericBuilderConfig, normalizeBuilderConfig } from '@/lib/shared/world-builder/defaults';
import { deploymentFromState, estimateRuntimeCost } from '@/lib/shared/world-runtime/lifecycle';
import { slugifyRoute } from '@/lib/shared/routes';
import { getVerifiedWorldBalance, verifyWorldContract } from '@/lib/server/live-runtime-verification';
import type { TriggerSummary, WorldBuilderConfig, WorldRuntimeMetadata } from '@/lib/shared/types';

interface Params {
  params: Promise<{ worldId: string }>;
}

function demoMetadata(worldId: string, isOwner: boolean): WorldRuntimeMetadata {
  const world = getDemoWorldState(worldId);
  const builder = normalizeBuilderConfig(createGenericBuilderConfig({ name: world.name, slug: world.templateSlug || slugifyRoute(world.name) || worldId }));
  return {
    world,
    builder,
    publicState: { zones: world.zones, factions: world.factions },
    balance: world.balance,
    capabilities: { canEdit: isOwner, canRunManualActions: isOwner, isOwner },
    triggers: demoTriggers.filter((trigger) => trigger.worldId === worldId),
    latestRun: null,
  };
}

function latestRunValue(value: unknown): WorldRuntimeMetadata['latestRun'] {
  return value && typeof value === 'object' && 'id' in value ? value as WorldRuntimeMetadata['latestRun'] : null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  const { worldId } = await params;
  if (!hasSupabaseAdminEnv()) return NextResponse.json(demoMetadata(worldId, Boolean(session)));

  const supabase = createAdminSupabaseClient();
  const userId = session ? await ensureSupabaseUser(session) : null;
  const data = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId, publicOnly: !userId });
  if (!data) return NextResponse.json({ error: 'World not found' }, { status: 404 });

  const worldState = data.world_state && typeof data.world_state === 'object'
    ? data.world_state as Record<string, unknown>
    : {};
  const builder = normalizeBuilderConfig((worldState.builder as WorldBuilderConfig | undefined) ?? createGenericBuilderConfig({ name: data.name, slug: slugifyRoute(data.name) || data.id }));
  const isOwner = Boolean(userId && data.owner_id === userId);
  const { data: triggers } = await supabase.from('triggers').select('*').eq('world_id', data.id).order('created_at', { ascending: false });
  const deployment = deploymentFromState(worldState);
  const costEstimate = estimateRuntimeCost(builder);
  const contractAddress = typeof data.contract_address === 'string' ? data.contract_address : '';
  const rpcBalance = contractAddress ? await getVerifiedWorldBalance(contractAddress).catch(() => null) : null;
  const contract = contractAddress ? await verifyWorldContract(contractAddress).catch(() => null) : null;
  if (rpcBalance && isOwner) {
    await supabase.from('world_balance_snapshots').insert({
      world_id: data.id,
      owner_id: userId,
      contract_address: contractAddress,
      balance_wei: rpcBalance.balanceWei,
      balance_stt: Number(rpcBalance.balanceStt),
      source: 'rpc_runtime_load',
    });
  }
  const balanceStt = rpcBalance?.balanceStt ?? String(data.sttt_balance);
  const effectiveStatus = effectiveWorldStatus(data);

  return NextResponse.json({
    world: {
      id: data.id,
      name: data.name,
      contractAddress: data.contract_address,
      template: data.template_id ?? 'Custom',
      templateSlug: builder.uiSlug,
      status: effectiveStatus,
      balance: `${balanceStt} STT`,
      activeAgents: Array.isArray(worldState.agents) ? worldState.agents.length : 0,
      createdAt: data.created_at,
    },
    builder,
    publicState: worldState,
    balance: `${balanceStt} STT`,
    deployment,
    costEstimate,
    contract,
    capabilities: { canEdit: isOwner, canRunManualActions: isOwner, isOwner },
    triggers: (triggers ?? []).map((trigger) => ({
      id: trigger.id,
      worldId: trigger.world_id,
      name: trigger.condition?.name ?? trigger.feed_config?.name ?? 'Trigger',
      feedType: trigger.feed_type,
      triggerType: trigger.condition?.triggerType ?? 'data_condition',
      conditionLabel: trigger.condition?.label ?? 'IF condition is true',
      agentName: trigger.condition?.agentName ?? 'Agent Chain',
      executionLane: trigger.execution_lane,
      cooldownMs: trigger.cooldown_ms,
      isActive: trigger.is_active,
      lastFiredAt: trigger.condition?.lastFiredAt ?? null,
      graphNodeId: trigger.condition?.graphNodeId,
      chain: trigger.condition?.chain ?? [],
      inputParser: trigger.condition?.inputParser ?? '',
      isStartTrigger: Boolean(trigger.condition?.isStartTrigger),
      graphPosition: trigger.condition?.graphPosition,
      sourceConfig: trigger.condition?.sourceConfig ?? {},
      typeConfig: trigger.condition?.typeConfig ?? {},
      outputMapping: trigger.condition?.outputMapping ?? [],
      nextTriggerIds: trigger.condition?.nextTriggerIds ?? [],
    } satisfies TriggerSummary)),
    latestRun: latestRunValue(worldState.latestRun),
  } satisfies WorldRuntimeMetadata);
}
