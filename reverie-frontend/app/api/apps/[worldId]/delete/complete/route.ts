import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { getVerifiedWorldBalance, verifyRuntimeTransaction } from '@/lib/server/live-runtime-verification';

interface Params {
  params: Promise<{ worldId: string }>;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to complete world deletion.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required to complete world deletion.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });
  const contractAddress = typeof world.contract_address === 'string' ? world.contract_address : '';
  const stopTxHash = typeof body.stopTxHash === 'string' ? body.stopTxHash : '';
  const withdrawTxHash = typeof body.withdrawTxHash === 'string' ? body.withdrawTxHash : '';
  const unsubscribeTxHashes = stringArray(body.unsubscribeTxHashes);
  const verifiedTransactions = [];
  if (contractAddress) {
    if (!stopTxHash || !withdrawTxHash) {
      return NextResponse.json({ error: 'Stop and withdraw transaction hashes are required for deployed world deletion.' }, { status: 400 });
    }
    for (const txHash of [stopTxHash, ...unsubscribeTxHashes, withdrawTxHash]) {
      const verified = await verifyRuntimeTransaction(txHash).catch((error) => {
        const message = error instanceof Error ? error.message : `Unable to verify ${txHash}.`;
        return { error: message };
      });
      if ('error' in verified) return NextResponse.json({ error: verified.error }, { status: 400 });
      if (verified.transaction.status !== 'success') {
        return NextResponse.json({ error: `Deletion transaction failed on-chain: ${txHash}` }, { status: 400 });
      }
      verifiedTransactions.push(verified.transaction);
    }
    const balance = await getVerifiedWorldBalance(contractAddress).catch(() => null);
    if (balance) {
      await supabase.from('world_balance_snapshots').insert({
        world_id: world.id,
        owner_id: userId,
        contract_address: contractAddress,
        balance_wei: balance.balanceWei,
        balance_stt: Number(balance.balanceStt),
        source: 'delete_withdraw',
      });
    }
    await supabase
      .from('world_reactivity_subscriptions')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('world_id', world.id)
      .eq('owner_id', userId);
    await supabase
      .from('worlds')
      .update({
        status: 'stopped',
        world_state: {
          ...objectValue(world.world_state),
          deleted: {
            stoppedAt: new Date().toISOString(),
            stopTxHash,
            withdrawTxHash,
            unsubscribeTxHashes,
            transactions: verifiedTransactions,
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', world.id)
      .eq('owner_id', userId);
  }

  const { data: assignedAgents } = await supabase
    .from('agents')
    .select('id,config')
    .eq('owner_id', userId);
  const worldOwnedAgentIds = (assignedAgents ?? []).filter((item) => {
    const config = objectValue(item.config);
    return config.assignedWorldId === worldId || config.assignedWorldId === world.id;
  }).map((agent) => String(agent.id));
  if (worldOwnedAgentIds.length > 0) {
    const { error } = await supabase.from('agents').delete().eq('owner_id', userId).in('id', worldOwnedAgentIds);
    if (error) return NextResponse.json({ error: 'Failed to delete world agents.' }, { status: 500 });
  }
  const { error } = await supabase.from('worlds').delete().eq('id', world.id).eq('owner_id', userId);
  if (error) return NextResponse.json({ error: 'Failed to delete world records.' }, { status: 500 });
  return NextResponse.json({
    success: true,
    deletedId: worldId,
    deletedAgentIds: worldOwnedAgentIds,
    transactions: verifiedTransactions,
  });
}
