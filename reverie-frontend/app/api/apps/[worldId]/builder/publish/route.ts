import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { createGenericBuilderConfig, normalizeBuilderConfig } from '@/lib/shared/world-builder/defaults';
import { worldUrl } from '@/lib/shared/routes';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import type { WorldBuilderConfig, WorldSummary } from '@/lib/shared/types';

interface Params {
  params: Promise<{ worldId: string }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatWorldSummary(world: {
  id: string;
  name: string;
  contract_address?: string | null;
  template_id?: string | null;
  world_state?: unknown;
  status?: WorldSummary['status'];
  sttt_balance?: number | string;
  created_at?: string;
}): WorldSummary {
  const state = objectValue(world.world_state);
  const agents = Array.isArray(state.agents) ? state.agents.filter((item): item is string => typeof item === 'string') : [];
  return {
    id: world.id,
    name: world.name,
    contractAddress: world.contract_address ?? '',
    template: typeof state.templateSlug === 'string' ? state.templateSlug : world.template_id ?? 'Custom',
    templateSlug: typeof state.templateSlug === 'string' ? state.templateSlug : 'custom',
    status: world.status ?? 'deployed',
    balance: `${world.sttt_balance ?? 0} STT`,
    activeAgents: agents.length,
    createdAt: world.created_at ?? new Date().toISOString(),
  };
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;
  const lastPublishedAt = new Date().toISOString();

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ lastPublishedAt, runtimeUrl: worldUrl({ id: worldId }, `/${worldId}`), source: 'demo' });
  }

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const current = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!current) return NextResponse.json({ error: 'World not found' }, { status: 404 });
  const currentState = current?.world_state && typeof current.world_state === 'object'
    ? current.world_state as Record<string, unknown>
    : {};
  const builder = normalizeBuilderConfig(currentState.builder && typeof currentState.builder === 'object'
    ? { ...currentState.builder as WorldBuilderConfig, lastPublishedAt }
    : { ...createGenericBuilderConfig({ name: 'World Runtime', slug: worldId }), lastPublishedAt });
  const worldState = { ...currentState, builder };
  const { data } = await supabase
    .from('worlds')
    .update({ world_state: worldState, updated_at: lastPublishedAt })
    .eq('id', current.id)
    .select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at')
    .single();

  return NextResponse.json({
    lastPublishedAt,
    runtimeUrl: worldUrl({ id: current.id, name: current.name }, `/${builder.uiSlug}`),
    world: data ? formatWorldSummary(data) : undefined,
    worldState,
  });
}
