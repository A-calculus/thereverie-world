import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { insertWorldEvent } from '@/lib/server/world-event-log';
import { liveWorldSummary, objectValue } from '@/lib/server/live-world';
import { getVerifiedWorldBalance, verifyRuntimeTransaction, verifyWorldContract } from '@/lib/server/live-runtime-verification';

interface Params {
  params: Promise<{ worldId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to record funding.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live world funding.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const transactionHash = typeof body.transactionHash === 'string' ? body.transactionHash : '';
  const amountStt = Number(body.amountStt ?? 0);
  if (!transactionHash || !Number.isFinite(amountStt) || amountStt <= 0) {
    return NextResponse.json({ error: 'Missing confirmed funding transaction details.' }, { status: 400 });
  }

  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });

  const currentState = objectValue(world.world_state);
  const contractAddress = typeof world.contract_address === 'string' ? world.contract_address : '';
  if (!contractAddress) return NextResponse.json({ error: 'Deploy this world before recording funding.' }, { status: 400 });
  let verification;
  let balance;
  let contract;
  try {
    [verification, balance, contract] = await Promise.all([
      verifyRuntimeTransaction(transactionHash),
      getVerifiedWorldBalance(contractAddress),
      verifyWorldContract(contractAddress),
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify funding on Somnia RPC.' }, { status: 400 });
  }
  if (verification.transaction.status !== 'success') {
    return NextResponse.json({ error: 'Funding transaction failed on-chain.' }, { status: 400 });
  }
  if (!contract.hasCode) {
    return NextResponse.json({ error: 'World address has no contract bytecode on Somnia RPC.' }, { status: 400 });
  }
  if (verification.transaction.to?.toLowerCase() !== contractAddress.toLowerCase()) {
    return NextResponse.json({ error: 'Funding transaction was not sent to this world contract.' }, { status: 400 });
  }
  const fundingHistory = Array.isArray(currentState.fundingHistory) ? currentState.fundingHistory : [];
  const now = new Date().toISOString();
  const worldState = {
    ...currentState,
    runtime: {
      ...objectValue(currentState.runtime),
      fundingMode: 'live',
      lastFundedAt: now,
    },
    fundingHistory: [
      {
        amountStt,
        transactionHash,
        transactionUrl: verification.transaction.transactionUrl,
        blockNumber: verification.transaction.blockNumber,
        confirmedBalanceStt: balance.balanceStt,
        mode: 'live',
        createdAt: now,
      },
      ...fundingHistory,
    ].slice(0, 20),
    lastUpdated: now,
  };

  const { data, error } = await supabase
    .from('worlds')
    .update({ sttt_balance: Number(balance.balanceStt), world_state: worldState, updated_at: now })
    .eq('id', world.id)
    .select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to record live funding.' }, { status: 500 });

  await supabase.from('world_balance_snapshots').insert({
    world_id: world.id,
    owner_id: userId,
    contract_address: contractAddress,
    balance_wei: balance.balanceWei,
    balance_stt: Number(balance.balanceStt),
    transaction_hash: transactionHash,
    block_number: verification.transaction.blockNumber,
    source: 'rpc',
  });

  await insertWorldEvent(supabase, {
    worldId: world.id,
    type: 'chronicle_entry',
    title: 'World funded',
    description: `Live funding transferred ${amountStt} STT to the world contract.`,
    transactionHash,
    result: { amountStt, balanceStt: balance.balanceStt, fundingMode: 'live', explorerUrl: verification.transaction.transactionUrl },
  });

  return NextResponse.json({
    world: liveWorldSummary(data),
    worldState,
    amount: String(amountStt),
    balance: `${data.sttt_balance} STT`,
    transactionHash,
    transactionUrl: verification.transaction.transactionUrl,
    verifiedTransaction: verification.transaction,
    mode: 'live',
  });
}
