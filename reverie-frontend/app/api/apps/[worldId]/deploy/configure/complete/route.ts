import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { insertWorldEvent } from '@/lib/server/world-event-log';
import { builderFromWorld, liveWorldSummary, objectValue } from '@/lib/server/live-world';
import { getVerifiedWorldBalance, verifyRuntimeTransaction, verifyWorldContract } from '@/lib/server/live-runtime-verification';

interface Params {
  params: Promise<{ worldId: string }>;
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to record live configuration.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live world configuration.' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const configureTxHash = stringValue(body.configureTxHash);
  const manifestHash = stringValue(body.manifestHash);
  if (!configureTxHash || !manifestHash) {
    return NextResponse.json({ error: 'Missing confirmed configuration transaction details.' }, { status: 400 });
  }

  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });
  const contractAddress = stringValue(world.contract_address);
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    return NextResponse.json({ error: 'Deploy this world before applying live configuration changes.' }, { status: 400 });
  }

  let configureVerification;
  let contractVerification;
  let balance;
  try {
    [configureVerification, contractVerification, balance] = await Promise.all([
      verifyRuntimeTransaction(configureTxHash),
      verifyWorldContract(contractAddress),
      getVerifiedWorldBalance(contractAddress),
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify configuration on Somnia RPC.' }, { status: 400 });
  }
  if (configureVerification.transaction.status !== 'success') {
    return NextResponse.json({ error: 'Manifest configuration transaction failed on-chain.' }, { status: 400 });
  }
  if (!contractVerification.hasCode) {
    return NextResponse.json({ error: 'World address has no contract bytecode on Somnia RPC.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const currentState = objectValue(world.world_state);
  const builder = builderFromWorld(world);
  const previousDeployment = objectValue(currentState.deployment);
  const liveState = objectValue(currentState.live);
  const deployment = {
    ...previousDeployment,
    mode: 'live',
    contractAddress,
    callbackReceiverAddress: contractAddress,
    defaultEmitterAddress: contractAddress,
    configureTransactionHash: configureTxHash,
    configureTransactionUrl: configureVerification.transaction.transactionUrl,
    manifestHash,
    contractUrl: contractVerification.addressUrl,
    updatedAt: now,
  };
  const worldState = {
    ...currentState,
    builder,
    deployment,
    live: {
      ...liveState,
      manifestHash,
      manifest: body.manifest ?? null,
      resolvedManifest: body.manifest ?? null,
      resolvedInputSnapshot: body.resolvedInputSnapshot ?? null,
      resolvedBuilder: body.resolvedBuilder ?? null,
      configureTxHash,
      configureVerification: configureVerification.transaction,
      lastConfiguredAt: now,
      lastSyncedAt: now,
    },
    runtime: {
      ...(objectValue(currentState.runtime)),
      mode: 'live',
      status: world.status,
    },
    lastUpdated: now,
  };

  const { data, error } = await supabase
    .from('worlds')
    .update({
      world_state: worldState,
      sttt_balance: Number(balance.balanceStt),
      updated_at: now,
    })
    .eq('id', world.id)
    .select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to record live configuration.' }, { status: 500 });

  await supabase.from('world_deployments').insert({
    world_id: world.id,
    owner_id: userId,
    contract_address: contractAddress,
    manifest_hash: manifestHash,
    manifest: body.manifest ?? {},
    deploy_tx_hash: stringValue(liveState.deployTxHash, configureTxHash),
    configure_tx_hash: configureTxHash,
    configure_block_number: configureVerification.transaction.blockNumber,
    tx_status: 'success',
    decoded_events: configureVerification.events,
    explorer_url: configureVerification.transaction.transactionUrl,
    status: 'configured',
  });

  const triggers = objectArray(objectValue(body.manifest).triggers);
  if (triggers.length > 0) {
    await supabase.from('world_reactivity_subscriptions').upsert(triggers.map((trigger, index) => ({
      world_id: world.id,
      owner_id: userId,
      trigger_id: stringValue(trigger.triggerId, `trigger-${index + 1}`),
      emitter_address: stringValue(trigger.emitter) || null,
      topic0: stringValue(trigger.topic0) || null,
      gas_limit: Number(trigger.gasLimit ?? 0) || null,
      status: 'compiled',
      updated_at: now,
    })), { onConflict: 'world_id,trigger_id' });
  }

  await insertWorldEvent(supabase, {
    worldId: world.id,
    type: 'chronicle_entry',
    title: 'Live manifest updated',
    description: `Live world configuration updated on ${contractAddress}.`,
    transactionHash: configureTxHash,
    result: { deployment, manifestHash, explorerUrl: configureVerification.transaction.transactionUrl, contractUrl: contractVerification.addressUrl },
  });

  return NextResponse.json({
    world: liveWorldSummary(data),
    worldState,
    deployment,
    transactionHash: configureTxHash,
    mode: 'live',
  });
}
