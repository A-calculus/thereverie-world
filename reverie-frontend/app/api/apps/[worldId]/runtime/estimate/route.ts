import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { createGenericBuilderConfig, normalizeBuilderConfig } from '@/lib/shared/world-builder/defaults';
import { estimateRuntimeCost } from '@/lib/shared/world-runtime/lifecycle';
import type { WorldBuilderConfig } from '@/lib/shared/types';

interface Params {
  params: Promise<{ worldId: string }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Runtime estimates require the database runtime.' }, { status: 503 });

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 });
  const state = objectValue(world.world_state);
  const builder = normalizeBuilderConfig((state.builder as WorldBuilderConfig | undefined) ?? createGenericBuilderConfig({ name: world.name, slug: world.id }));
  const costEstimate = estimateRuntimeCost(builder);
  return NextResponse.json({ costEstimate, balance: `${world.sttt_balance ?? 0} STT` });
}
