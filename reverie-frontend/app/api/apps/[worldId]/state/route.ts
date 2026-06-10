import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getDemoWorldState } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';

interface Params {
  params: Promise<{ worldId: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;
  if (!hasSupabaseAdminEnv()) return NextResponse.json(getDemoWorldState(worldId));

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId, publicOnly: !userId });
  if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 });

  const worldState = world.world_state && typeof world.world_state === 'object'
    ? world.world_state
    : {};
  return NextResponse.json({
    id: world.id,
    name: world.name,
    contractAddress: world.contract_address,
    status: world.status,
    balance: `${world.sttt_balance} STT`,
    createdAt: world.created_at,
    worldState,
  });
}
