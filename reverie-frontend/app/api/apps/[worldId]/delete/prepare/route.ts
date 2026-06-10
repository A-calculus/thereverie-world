import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { getVerifiedWorldBalance } from '@/lib/server/live-runtime-verification';
import { evmAddressUrl } from '@/lib/shared/explorer-links';

interface Params {
  params: Promise<{ worldId: string }>;
}

export async function POST(_req: Request, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to delete this world.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required to prepare world deletion.' }, { status: 503 });
  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });
  const { data: subscriptions } = await supabase
    .from('world_reactivity_subscriptions')
    .select('trigger_id,subscription_id,status')
    .eq('world_id', world.id)
    .eq('owner_id', userId)
    .eq('status', 'active');
  const contractAddress = typeof world.contract_address === 'string' ? world.contract_address : '';
  const balance = contractAddress ? await getVerifiedWorldBalance(contractAddress).catch(() => null) : null;
  return NextResponse.json({
    worldId: world.id,
    contractAddress,
    contractUrl: contractAddress ? evmAddressUrl(contractAddress) : null,
    balance,
    steps: contractAddress
      ? ['stop_world', 'unsubscribe_active_triggers', 'withdraw_remaining_balance', 'delete_frontend_records']
      : ['delete_frontend_records'],
    subscriptions: subscriptions ?? [],
    message: contractAddress
      ? 'Stop the world, unsubscribe active trigger subscriptions when available, withdraw remaining STT to the owner wallet, then delete frontend records.'
      : 'This world has no deployed contract. Frontend records can be deleted directly.',
  });
}
