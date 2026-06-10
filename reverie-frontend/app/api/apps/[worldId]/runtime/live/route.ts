import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { builderFromWorld, compileSerializableManifest, liveWorldSummary, objectValue } from '@/lib/server/live-world';
import { resolveBuilderForServerManifest } from '@/lib/server/live-builder-resolution';
import { evmAddressUrl } from '@/lib/shared/explorer-links';
import { getVerifiedWorldBalance, hydrateCompiledManifestState, verifyWorldContract } from '@/lib/server/live-runtime-verification';
import { buildRuntimeTimeline } from '@/lib/server/runtime-timeline';

interface Params {
  params: Promise<{ worldId: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect a wallet to inspect live runtime.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live runtime inspection.' }, { status: 503 });
  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId, publicOnly: !userId });
  if (!world) return NextResponse.json({ error: 'World not found.' }, { status: 404 });

  const state = objectValue(world.world_state);
  const { data: deployments } = await supabase
    .from('world_deployments')
    .select('*')
    .eq('world_id', world.id)
    .order('created_at', { ascending: false })
    .limit(5);
  const { data: subscriptions } = await supabase
    .from('world_reactivity_subscriptions')
    .select('*')
    .eq('world_id', world.id)
    .order('created_at', { ascending: false });
  const { data: runs } = await supabase
    .from('world_runtime_runs')
    .select('*')
    .eq('world_id', world.id)
    .order('created_at', { ascending: false })
    .limit(20);
  const { data: requests } = await supabase
    .from('world_agent_requests')
    .select('*')
    .eq('world_id', world.id)
    .order('created_at', { ascending: false })
    .limit(50);
  const { data: balances } = await supabase
    .from('world_balance_snapshots')
    .select('*')
    .eq('world_id', world.id)
    .order('created_at', { ascending: false })
    .limit(10);
  const contractAddress = typeof world.contract_address === 'string' ? world.contract_address : '';
  const rawBuilder = builderFromWorld(world);
  const publicState = objectValue(state.publicState ?? state);
  const { builder, snapshot: resolvedInputSnapshot } = await resolveBuilderForServerManifest({
    builder: rawBuilder,
    publicState,
  });
  const manifest = compileSerializableManifest(builder);
  const rpcBalance = contractAddress ? await getVerifiedWorldBalance(contractAddress).catch(() => null) : null;
  const contract = contractAddress ? await verifyWorldContract(contractAddress).catch(() => ({
    address: contractAddress,
    addressUrl: evmAddressUrl(contractAddress),
    hasCode: false,
  })) : null;
  const liveManifestState = contractAddress
    ? await hydrateCompiledManifestState({ address: contractAddress, manifest }).catch(() => null)
    : null;
  const fundingWarnings = (requests ?? []).flatMap((request) => {
    const result = objectValue(request.result);
    const receiptDetails = objectValue(result.receiptDetails);
    return receiptDetails.status === 'insufficient_budget'
      ? [{
          requestId: request.request_id,
          message: receiptDetails.errorMessage ?? 'Native agent request returned insufficient budget.',
          receiptUrl: request.receipt_url,
        }]
      : [];
  });
  const confirmedSubscriptions = (subscriptions ?? []).filter((subscription) => (
    subscription.status === 'active' &&
    (Boolean(subscription.subscription_id) || Boolean(subscription.subscribe_tx_hash))
  ));
  const { timeline, aggregates } = await buildRuntimeTimeline({ supabase, world, limit: 80 });
  const latestActivity = timeline[0] ?? null;

  return NextResponse.json({
    world: liveWorldSummary(world),
    builder,
    manifest,
    resolvedInputSnapshot,
    liveManifestState,
    deployment: objectValue(state.deployment),
    live: objectValue(state.live),
    reconcileCheckpoint: objectValue(objectValue(state.live).reconcileCheckpoint),
    runtime: objectValue(state.runtime),
    latestRun: state.latestRun ?? null,
    deployments: deployments ?? [],
    subscriptions: subscriptions ?? [],
    confirmedSubscriptions,
    runs: runs ?? [],
    requests: requests ?? [],
    balanceSnapshots: balances ?? [],
    rpcBalance,
    contract,
    fundingWarnings,
    timeline,
    aggregates,
    latestActivityAt: latestActivity?.createdAt ?? null,
    latestActivityKind: latestActivity?.kind ?? null,
    latestActivitySummary: latestActivity?.summary ?? null,
  });
}
