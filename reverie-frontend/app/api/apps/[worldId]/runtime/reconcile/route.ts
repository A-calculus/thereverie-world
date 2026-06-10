import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { builderFromWorld, compileSerializableManifest, liveWorldSummary, objectValue } from '@/lib/server/live-world';
import { resolveBuilderForServerManifest } from '@/lib/server/live-builder-resolution';
import { agentReceiptUrl } from '@/lib/shared/explorer-links';
import { getLatestRuntimeBlock, getRuntimeEventScan, getVerifiedWorldBalance, hydrateCompiledManifestState, type RuntimeDecodedEvent } from '@/lib/server/live-runtime-verification';
import { fetchAgentReceiptDetails } from '@/lib/server/agent-receipts';
import { buildReconciledEffects, mergeReconciledManifestState } from '@/lib/server/reconciled-effects';

interface Params {
  params: Promise<{ worldId: string }>;
}

function numberLike(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function maxBlock(...values: Array<unknown>): string | undefined {
  const blocks = values
    .map(numberLike)
    .filter((value): value is string => Boolean(value))
    .map((value) => BigInt(value));
  if (blocks.length === 0) return undefined;
  return blocks.reduce((max, value) => value > max ? value : max, blocks[0]).toString();
}

function recentWindowStart(anchor: bigint, windowSize = BigInt(1000)) {
  return anchor > windowSize ? anchor - windowSize + BigInt(1) : BigInt(0);
}

function statusFor(event: RuntimeDecodedEvent) {
  if (event.kind === 'AgentDecisionReceived' || event.kind === 'JsonOracleReceived') return 'complete';
  return 'pending';
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect a wallet to reconcile live runtime.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live runtime reconciliation.' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });
  if (!world.contract_address) return NextResponse.json({ error: 'Deploy this world before reconciling runtime logs.' }, { status: 400 });

  const { data: latestDeployment } = await supabase
    .from('world_deployments')
    .select('deploy_block_number,configure_block_number')
    .eq('world_id', world.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: latestRun } = await supabase
    .from('world_runtime_runs')
    .select('block_number')
    .eq('world_id', world.id)
    .not('block_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: latestRequest } = await supabase
    .from('world_agent_requests')
    .select('block_number')
    .eq('world_id', world.id)
    .not('block_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: latestSubscription } = await supabase
    .from('world_reactivity_subscriptions')
    .select('subscribe_block_number')
    .eq('world_id', world.id)
    .not('subscribe_block_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const state = objectValue(world.world_state);
  const liveState = objectValue(state.live);
  const checkpoint = objectValue(liveState.reconcileCheckpoint);
  const latestBlock = await getLatestRuntimeBlock();
  const latestKnownBlock = maxBlock(
    latestDeployment?.configure_block_number,
    latestDeployment?.deploy_block_number,
    latestRun?.block_number,
    latestRequest?.block_number,
    latestSubscription?.subscribe_block_number,
  );
  const anchorBlock = latestKnownBlock && BigInt(latestKnownBlock) > latestBlock ? BigInt(latestKnownBlock) : latestBlock;
  const explicitFromBlock = numberLike(body.fromBlock);
  const backfillFromCheckpoint = body.mode === 'backfill' || body.backfill === true;
  const fromBlock = explicitFromBlock
    ?? (backfillFromCheckpoint ? numberLike(checkpoint.nextFromBlock) : undefined)
    ?? recentWindowStart(anchorBlock).toString();
  const toBlock = numberLike(body.toBlock) ?? latestBlock.toString();
  const scan = await getRuntimeEventScan({
    address: world.contract_address,
    fromBlock,
    toBlock,
    maxChunks: typeof body.maxChunks === 'number' ? body.maxChunks : undefined,
  });
  const events = scan.events;
  const publicState = objectValue(state.publicState ?? state);
  const { builder } = await resolveBuilderForServerManifest({
    builder: builderFromWorld(world),
    publicState,
  });
  const manifest = compileSerializableManifest(builder);
  const liveManifestState = await hydrateCompiledManifestState({
    address: world.contract_address,
    manifest,
  }).catch(() => null);
  const reconciled = buildReconciledEffects({
    existing: objectValue(liveState.reconciledEffects),
    builder,
    manifest,
    events,
  });
  const mergedManifestState = mergeReconciledManifestState({
    manifestState: liveManifestState,
    builder,
    effects: reconciled.effects,
  });

  const requestEvents = events.filter((event) => event.requestId);
  for (const event of requestEvents) {
    const status = statusFor(event);
    let existingResult: Record<string, unknown> = {};
    if (status === 'complete') {
      const { data: existing } = await supabase
        .from('world_agent_requests')
        .select('result')
        .eq('world_id', world.id)
        .eq('request_id', event.requestId)
        .maybeSingle();
      existingResult = objectValue(existing?.result);
    }
    let receiptDetails = objectValue(existingResult.receiptDetails);
    if (Object.keys(receiptDetails).length === 0 && event.requestId && /^\d+$/.test(event.requestId)) {
      receiptDetails = await fetchAgentReceiptDetails(event.requestId).then((receipt) => ({ ...receipt })).catch(() => ({}));
    }
    const receiptStatus = typeof receiptDetails.status === 'string' ? receiptDetails.status : '';
    const capabilityIds = stringArray(existingResult.mcpCapabilityIds);
    if (status === 'complete' && capabilityIds.length > 0) {
      await supabase
        .from('tool_mcp_capabilities')
        .update({
          revoked_at: new Date().toISOString(),
          revoked_reason: 'agent_response_received',
          request_id: event.requestId,
          updated_at: new Date().toISOString(),
        })
        .in('id', capabilityIds)
        .eq('owner_id', userId)
        .is('revoked_at', null);
    }
    await supabase.from('world_agent_requests').upsert({
      world_id: world.id,
      owner_id: userId,
      trigger_id: event.triggerId ?? null,
      request_id: event.requestId,
      receipt_url: event.receiptUrl ?? agentReceiptUrl(event.requestId!),
      transaction_hash: event.transactionHash ?? null,
      block_number: event.blockNumber ?? null,
      step_index: event.stepIndex ?? null,
      agent_kind: event.agentKind ?? null,
      callback_status: status,
      tx_status: 'success',
      decoded_events: [event],
      explorer_url: event.transactionUrl ?? null,
      status,
      result: {
        ...existingResult,
        ...(status === 'complete' ? { output: event.result ?? event.args.result ?? '', completedBy: event.kind } : {}),
        ...(Object.keys(receiptDetails).length > 0 ? { receiptDetails } : {}),
      },
      ...(receiptStatus === 'insufficient_budget' ? { status: 'insufficient_budget', callback_status: 'failed' } : {}),
    }, { onConflict: 'world_id,request_id' });
  }

  const completed = events.filter((event) => event.kind === 'WorkflowCompleted');
  if (completed.length > 0) {
    await supabase
      .from('world_runtime_runs')
      .update({
        status: 'complete',
        decoded_events: events,
        summary: {
          reconciledAt: new Date().toISOString(),
          workflowCompletions: completed.map((event) => event.args),
          requestIds: requestEvents.map((event) => event.requestId),
        },
      })
      .eq('world_id', world.id)
      .in('status', ['submitted', 'pending']);
  }

  const balance = await getVerifiedWorldBalance(world.contract_address);
  const now = new Date().toISOString();
  const nextFromBlock = scan.nextFromBlock ?? (scan.scannedToBlock ? (BigInt(scan.scannedToBlock) + BigInt(1)).toString() : fromBlock);
  const worldState = {
    ...state,
    live: {
      ...objectValue(state.live),
      lastReconciledAt: now,
      lastWorkflowEvents: events,
      manifestState: liveManifestState,
      mergedManifestState,
      reconciledEffects: reconciled.effects,
      latestDecisionContinuation: reconciled.latestDecisionContinuation ?? objectValue(liveState.latestDecisionContinuation),
      reconcileCheckpoint: {
        fromBlock,
        scannedToBlock: scan.scannedToBlock,
        nextFromBlock,
        latestBlock: scan.latestBlock,
        complete: scan.complete,
        chunks: scan.chunks,
        chunkSize: scan.chunkSize,
        updatedAt: now,
      },
    },
    runtime: {
      ...objectValue(state.runtime),
      status: completed.length > 0 ? 'running' : objectValue(state.runtime).status ?? 'running',
    },
    lastUpdated: now,
    zones: mergedManifestState.zones ?? liveManifestState?.zones ?? state.zones,
    factions: mergedManifestState.factions ?? liveManifestState?.factions ?? state.factions,
  };
  const { data, error } = await supabase
    .from('worlds')
    .update({ world_state: worldState, sttt_balance: Number(balance.balanceStt), updated_at: now })
    .eq('id', world.id)
    .select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to persist reconciled runtime state.' }, { status: 500 });

  await supabase.from('world_balance_snapshots').insert({
    world_id: world.id,
    owner_id: userId,
    contract_address: world.contract_address,
    balance_wei: balance.balanceWei,
    balance_stt: Number(balance.balanceStt),
    source: 'rpc_reconcile',
  });

  return NextResponse.json({
    world: liveWorldSummary(data),
    worldState,
    events,
    manifest,
    liveManifestState,
    reconcileCheckpoint: worldState.live.reconcileCheckpoint,
    requestCount: requestEvents.length,
    completedCount: completed.length,
    balance,
  });
}
