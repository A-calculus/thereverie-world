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

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to record deployment.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live world deployment.' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const contractAddress = stringValue(body.contractAddress);
  const deployTxHash = stringValue(body.deployTxHash);
  const configureTxHash = stringValue(body.configureTxHash);
  const manifestHash = stringValue(body.manifestHash);
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress) || !deployTxHash || !configureTxHash || !manifestHash) {
    return NextResponse.json({ error: 'Missing confirmed deployment transaction details.' }, { status: 400 });
  }

  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });

  const currentState = objectValue(world.world_state);
  const builder = builderFromWorld(world);
  let deployVerification;
  let configureVerification;
  let contractVerification;
  let balance;
  try {
    [deployVerification, configureVerification, contractVerification, balance] = await Promise.all([
      verifyRuntimeTransaction(deployTxHash),
      verifyRuntimeTransaction(configureTxHash),
      verifyWorldContract(contractAddress),
      getVerifiedWorldBalance(contractAddress),
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify deployment on Somnia RPC.' }, { status: 400 });
  }
  if (deployVerification.transaction.status !== 'success' || configureVerification.transaction.status !== 'success') {
    return NextResponse.json({ error: 'Deployment or manifest configuration transaction failed on-chain.' }, { status: 400 });
  }
  if (!contractVerification.hasCode) {
    return NextResponse.json({ error: 'World address has no contract bytecode on Somnia RPC.' }, { status: 400 });
  }
  const now = new Date().toISOString();
  const deployment = {
    mode: 'live',
    contractAddress,
    callbackReceiverAddress: contractAddress,
    defaultEmitterAddress: contractAddress,
    transactionHash: deployTxHash,
    transactionUrl: deployVerification.transaction.transactionUrl,
    configureTransactionHash: configureTxHash,
    configureTransactionUrl: configureVerification.transaction.transactionUrl,
    subscriptionTxHashes: stringArray(body.subscriptionTxHashes),
    manifestHash,
    contractUrl: contractVerification.addressUrl,
    deployedAt: now,
  };
  const worldState = {
    ...currentState,
    builder,
    deployment,
    live: {
      ...(objectValue(currentState.live)),
      manifestHash,
      manifest: body.manifest ?? null,
      deployTxHash,
      configureTxHash,
      deployVerification: deployVerification.transaction,
      configureVerification: configureVerification.transaction,
      subscriptionTxHashes: deployment.subscriptionTxHashes,
      lastSyncedAt: now,
    },
    runtime: {
      ...(objectValue(currentState.runtime)),
      mode: 'live',
      status: 'deployed',
    },
    lastUpdated: now,
  };

  const { data, error } = await supabase
    .from('worlds')
    .update({
      contract_address: contractAddress,
      world_state: worldState,
      status: 'deployed',
      sttt_balance: Number(balance.balanceStt),
      updated_at: now,
    })
    .eq('id', world.id)
    .select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to record live deployment.' }, { status: 500 });

  await supabase.from('world_deployments').insert({
    world_id: world.id,
    owner_id: userId,
    contract_address: contractAddress,
    manifest_hash: manifestHash,
    manifest: body.manifest ?? {},
    deploy_tx_hash: deployTxHash,
    configure_tx_hash: configureTxHash,
    deploy_block_number: deployVerification.transaction.blockNumber,
    configure_block_number: configureVerification.transaction.blockNumber,
    tx_status: 'success',
    decoded_events: [...deployVerification.events, ...configureVerification.events],
    explorer_url: deployVerification.transaction.transactionUrl,
    subscription_tx_hashes: deployment.subscriptionTxHashes,
    status: 'deployed',
  });

  await supabase.from('world_balance_snapshots').insert({
    world_id: world.id,
    owner_id: userId,
    contract_address: contractAddress,
    balance_wei: balance.balanceWei,
    balance_stt: Number(balance.balanceStt),
    transaction_hash: configureTxHash,
    block_number: configureVerification.transaction.blockNumber,
    source: 'rpc',
  });

  const triggers = objectArray(objectValue(body.manifest).triggers);
  if (triggers.length > 0) {
    const subscriptionRows = triggers.map((trigger, index) => ({
      world_id: world.id,
      owner_id: userId,
      trigger_id: stringValue(trigger.triggerId, `trigger-${index + 1}`),
      emitter_address: stringValue(trigger.emitter) || null,
      topic0: stringValue(trigger.topic0) || null,
      gas_limit: Number(trigger.gasLimit ?? 0) || null,
      subscribe_tx_hash: deployment.subscriptionTxHashes[index] ?? null,
      status: deployment.subscriptionTxHashes[index] ? 'active' : 'compiled',
    }));
    await supabase
      .from('world_reactivity_subscriptions')
      .upsert(subscriptionRows, { onConflict: 'world_id,trigger_id' });
  }

  await insertWorldEvent(supabase, {
    worldId: world.id,
    type: 'chronicle_entry',
    title: 'Live world deployed',
    description: `Live world contract deployed at ${contractAddress}.`,
    transactionHash: deployTxHash,
    result: { deployment, manifestHash, explorerUrl: deployVerification.transaction.transactionUrl, contractUrl: contractVerification.addressUrl },
  });

  return NextResponse.json({
    world: liveWorldSummary(data),
    worldState,
    deployment,
    transactionHash: deployTxHash,
    mode: 'live',
  });
}
