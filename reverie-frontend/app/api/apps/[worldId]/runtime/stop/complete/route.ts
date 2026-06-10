import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { insertWorldEvent } from '@/lib/server/world-event-log';
import { liveWorldSummary, objectValue } from '@/lib/server/live-world';
import { verifyRuntimeTransaction } from '@/lib/server/live-runtime-verification';

interface Params {
  params: Promise<{ worldId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to record runtime stop.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live runtime updates.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const transactionHash = typeof body.transactionHash === 'string' ? body.transactionHash : '';
  const reason = typeof body.reason === 'string' ? body.reason : 'Stopped manually by owner.';
  if (!transactionHash) return NextResponse.json({ error: 'Missing confirmed stop transaction hash.' }, { status: 400 });

  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });
  let verification;
  try {
    verification = await verifyRuntimeTransaction(transactionHash);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify stop transaction on Somnia RPC.' }, { status: 400 });
  }
  if (verification.transaction.status !== 'success') return NextResponse.json({ error: 'Stop transaction failed on-chain.' }, { status: 400 });

  const now = new Date().toISOString();
  const currentState = objectValue(world.world_state);
  const worldState = {
    ...currentState,
    stopReason: reason,
    runtime: { ...objectValue(currentState.runtime), mode: 'live', status: 'stopped', stoppedAt: now, stopReason: reason },
    live: { ...objectValue(currentState.live), lastStopTransaction: verification.transaction, lastSyncedAt: now },
    lastUpdated: now,
  };
  const { data, error } = await supabase.from('worlds').update({
    world_state: worldState,
    status: 'stopped',
    updated_at: now,
  }).eq('id', world.id).select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at').single();
  if (error) return NextResponse.json({ error: 'Failed to record live runtime stop.' }, { status: 500 });

  await insertWorldEvent(supabase, {
    worldId: world.id,
    type: 'trigger_fired',
    title: 'Runtime stopped',
    description: reason,
    transactionHash,
    result: { runtimeStatus: 'stopped', mode: 'live', reason, transactionUrl: verification.transaction.transactionUrl },
  });

  return NextResponse.json({ world: liveWorldSummary(data), worldState, runtimeStatus: 'stopped', stopReason: reason, transactionHash, transactionUrl: verification.transaction.transactionUrl, verifiedTransaction: verification.transaction, mode: 'live' });
}
