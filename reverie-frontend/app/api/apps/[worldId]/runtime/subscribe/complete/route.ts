import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { liveWorldSummary, objectValue } from '@/lib/server/live-world';
import { verifyRuntimeTransaction, type RuntimeVerifiedTransaction } from '@/lib/server/live-runtime-verification';

interface Params {
  params: Promise<{ worldId: string }>;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function objectArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to record trigger subscriptions.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live runtime updates.' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const txHashes = stringArray(body.transactionHashes ?? body.txHashes);
  const providedSubscriptions = objectArray(body.subscriptions);
  if (txHashes.length === 0) return NextResponse.json({ error: 'No subscription transactions provided.' }, { status: 400 });

  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });

  const verifications: Array<{
    transaction: RuntimeVerifiedTransaction;
    events: Awaited<ReturnType<typeof verifyRuntimeTransaction>>['events'];
    reactivityEvents: Awaited<ReturnType<typeof verifyRuntimeTransaction>>['reactivityEvents'];
  }> = [];
  for (const txHash of txHashes) {
    let verified;
    try {
      verified = await verifyRuntimeTransaction(txHash);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify subscription transaction.' }, { status: 400 });
    }
    if (verified.transaction.status !== 'success') {
      return NextResponse.json({ error: `Subscription transaction failed on-chain: ${txHash}` }, { status: 400 });
    }
    verifications.push(verified);
  }

  const rows = verifications.flatMap((verified) => verified.events
    .filter((event) => event.kind === 'ManifestTriggerSubscribed')
    .map((event) => ({
      world_id: world.id,
      owner_id: userId,
      trigger_id: String(event.args.triggerId ?? event.triggerId ?? ''),
      subscription_id: String(event.args.subscriptionId ?? ''),
      emitter_address: typeof event.args.emitter === 'string' ? event.args.emitter : null,
      topic0: typeof event.args.topic0 === 'string' ? event.args.topic0 : null,
      gas_limit: null,
      subscribe_tx_hash: verified.transaction.transactionHash,
      subscribe_block_number: verified.transaction.blockNumber,
      tx_status: verified.transaction.status,
      decoded_events: verified.events,
      explorer_url: verified.transaction.transactionUrl,
      status: 'active',
      last_fired_at: null,
    }))
    .filter((row) => row.trigger_id && row.subscription_id));

  const sdkRows = providedSubscriptions.map((subscription) => {
    const txHash = stringValue(subscription.txHash);
    const verified = verifications.find((item) => item.transaction.transactionHash === txHash);
    const reactivityEvent = objectArray(subscription.reactivityEvents)[0] ?? objectArray(verified?.reactivityEvents)[0] ?? {};
    return {
      world_id: world.id,
      owner_id: userId,
      trigger_id: String(subscription.triggerId ?? ''),
      subscription_id: stringValue(reactivityEvent.subscriptionId) ?? stringValue(subscription.subscriptionId),
      emitter_address: stringValue(subscription.emitter),
      topic0: stringValue(subscription.topic0),
      gas_limit: subscription.gasLimit ? Number(subscription.gasLimit) : null,
      subscribe_tx_hash: txHash,
      subscribe_block_number: verified?.transaction.blockNumber ?? null,
      tx_status: verified?.transaction.status ?? 'success',
      decoded_events: verified?.events ?? [],
      explorer_url: verified?.transaction.transactionUrl ?? null,
      status: 'active',
      last_fired_at: null,
    };
  }).filter((row) => row.trigger_id && row.subscribe_tx_hash);

  const mergedRows = [...rows, ...sdkRows.filter((sdkRow) => !rows.some((row) => row.trigger_id === sdkRow.trigger_id))];

  if (mergedRows.length > 0) {
    const { error } = await supabase
      .from('world_reactivity_subscriptions')
      .upsert(mergedRows, { onConflict: 'world_id,trigger_id' });
    if (error) return NextResponse.json({ error: 'Failed to record trigger subscriptions.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const state = objectValue(world.world_state);
  const runtime = {
    ...objectValue(state.runtime),
    mode: 'live',
    status: 'subscribed',
    lastSubscribedAt: now,
  };
  const worldState = {
    ...state,
    runtime,
    live: {
      ...objectValue(state.live),
      subscriptionTxHashes: txHashes,
      subscriptionEvents: verifications.flatMap((verified) => verified.events),
      lastSyncedAt: now,
    },
    lastUpdated: now,
  };

  const { data, error } = await supabase
    .from('worlds')
    .update({ world_state: worldState, updated_at: now })
    .eq('id', world.id)
    .select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to update world subscription state.' }, { status: 500 });

  return NextResponse.json({
    world: liveWorldSummary(data),
    worldState,
    subscriptions: mergedRows,
    transactions: verifications.map((verified) => verified.transaction),
    mode: 'live',
  });
}
