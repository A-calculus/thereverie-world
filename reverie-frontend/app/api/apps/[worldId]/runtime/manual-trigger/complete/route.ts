import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { insertWorldEvent } from '@/lib/server/world-event-log';
import { liveWorldSummary, objectValue } from '@/lib/server/live-world';
import { agentReceiptUrl } from '@/lib/shared/explorer-links';
import { verifyRuntimeTransaction, type RuntimeDecodedEvent } from '@/lib/server/live-runtime-verification';

interface Params {
  params: Promise<{ worldId: string }>;
}

function requestRowsFromEvents(events: RuntimeDecodedEvent[], worldId: string, ownerId: string, fallbackTriggerId: string) {
  const byRequest = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    if (!event.requestId) continue;
    const current = byRequest.get(event.requestId) ?? {
      world_id: worldId,
      owner_id: ownerId,
      trigger_id: event.triggerId ?? fallbackTriggerId,
      request_id: event.requestId,
      receipt_url: event.receiptUrl ?? agentReceiptUrl(event.requestId),
      transaction_hash: event.transactionHash ?? null,
      block_number: event.blockNumber ?? null,
      step_index: event.stepIndex ?? null,
      agent_kind: event.agentKind ?? null,
      callback_status: 'pending',
      tx_status: 'success',
      decoded_events: [],
      explorer_url: event.transactionUrl ?? null,
      status: 'pending',
      result: {},
    };
    const decodedEvents = Array.isArray(current.decoded_events) ? current.decoded_events : [];
    decodedEvents.push(event);
    current.decoded_events = decodedEvents;
    if (event.kind === 'AgentDecisionReceived' || event.kind === 'JsonOracleReceived') {
      current.callback_status = 'complete';
      current.status = 'complete';
      current.result = { output: event.result ?? event.args.result ?? '', completedBy: event.kind };
    }
    byRequest.set(event.requestId, current);
  }
  return [...byRequest.values()];
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to record manual trigger.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live runtime updates.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const transactionHash = typeof body.transactionHash === 'string' ? body.transactionHash : '';
  const triggerId = typeof body.triggerId === 'string' ? body.triggerId : '';
  const mcpCapabilityIds = Array.isArray(body.mcpCapabilityIds) ? body.mcpCapabilityIds.filter((item: unknown): item is string => typeof item === 'string') : [];
  if (!transactionHash || !triggerId) return NextResponse.json({ error: 'Missing confirmed manual trigger details.' }, { status: 400 });

  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to resolve owner profile.' }, { status: 401 });
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });

  const now = new Date().toISOString();
  const currentState = objectValue(world.world_state);
  let verification;
  try {
    verification = await verifyRuntimeTransaction(transactionHash);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify manual trigger on Somnia RPC.' }, { status: 400 });
  }
  if (verification.transaction.status !== 'success') {
    return NextResponse.json({ error: 'Manual trigger transaction failed on-chain.' }, { status: 400 });
  }
  const workflowCompleted = verification.events.find((event) => event.kind === 'WorkflowCompleted');
  const requestRows = requestRowsFromEvents(verification.events, world.id, userId, triggerId);
  for (const row of requestRows) {
    row.result = { ...objectValue(row.result), mcpCapabilityIds };
  }
  if (requestRows.length > 0) {
    await supabase.from('world_agent_requests').upsert(requestRows, { onConflict: 'world_id,request_id' });
  }
  const agentResponses = requestRows.map((row) => ({
    id: String(row.request_id),
    name: `${String(row.agent_kind ?? 'native')} request ${String(row.request_id)}`,
    agentType: row.agent_kind === 'json_api' ? 'native_json_api' : row.agent_kind === 'web_parse' ? 'native_web_parse' : 'native_llm',
    request: { requestId: row.request_id, triggerId: row.trigger_id, stepIndex: row.step_index },
    response: row.result,
    receiptUrl: String(row.receipt_url ?? ''),
    status: row.status === 'complete' ? 'complete' : 'pending',
  }));
  const run = {
    id: `live-manual-${Date.now()}`,
    actionId: triggerId,
    engine: objectValue(currentState.builder).engine ?? 'genericEventWorld',
    status: workflowCompleted ? 'complete' : 'pending',
    inputs: body.inputs ?? {},
    summary: {
      triggerId,
      transactionHash,
      transactionUrl: verification.transaction.transactionUrl,
      blockNumber: verification.transaction.blockNumber,
      requestIds: requestRows.map((row) => row.request_id),
      workflowCompleted: Boolean(workflowCompleted),
      finalResult: workflowCompleted?.result ?? null,
      mode: 'live',
    },
    agentResponses,
    events: verification.events.map((event, index) => ({
      id: `live-event-${event.kind}-${index}`,
      type: event.kind === 'ZoneUpdated' ? 'zone_updated' : event.kind === 'AgentDecisionReceived' || event.kind === 'JsonOracleReceived' ? 'agent_decision' : 'trigger_fired',
      title: event.kind,
      description: event.result ?? JSON.stringify(event.args),
      timestamp: now,
      receiptId: event.requestId,
    })),
    receipts: requestRows.map((row) => ({
      id: String(row.request_id),
      url: String(row.receipt_url),
      label: `Agent receipt ${String(row.request_id)}`,
    })),
    graph: objectValue(objectValue(currentState.builder).graph),
    worldState: currentState,
    createdAt: now,
  };
  const worldState = {
    ...currentState,
    latestRun: run,
    runtime: { ...objectValue(currentState.runtime), mode: 'live', status: 'running', lastManualActionAt: now },
    live: {
      ...objectValue(currentState.live),
      lastManualTrigger: verification.transaction,
      lastWorkflowEvents: verification.events,
      lastSyncedAt: now,
    },
    lastUpdated: now,
  };
  const { data, error } = await supabase.from('worlds').update({
    world_state: worldState,
    status: 'running',
    updated_at: now,
  }).eq('id', world.id).select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at').single();
  if (error) return NextResponse.json({ error: 'Failed to record live manual trigger.' }, { status: 500 });

  await supabase.from('world_runtime_runs').insert({
    world_id: world.id,
    owner_id: userId,
    trigger_id: triggerId,
    transaction_hash: transactionHash,
    block_number: verification.transaction.blockNumber,
    tx_status: verification.transaction.status,
    decoded_events: verification.events,
    explorer_url: verification.transaction.transactionUrl,
    status: workflowCompleted ? 'complete' : 'submitted',
    summary: run.summary,
  });

  await insertWorldEvent(supabase, {
    worldId: world.id,
    type: 'trigger_fired',
    title: 'Manual trigger fired',
    description: `Live trigger ${triggerId} fired on-chain.`,
    transactionHash,
    receiptId: requestRows[0]?.request_id ? String(requestRows[0].request_id) : null,
    result: { triggerId, mode: 'live', transactionUrl: verification.transaction.transactionUrl, requestIds: requestRows.map((row) => row.request_id) },
  });

  return NextResponse.json({
    world: liveWorldSummary(data),
    worldState,
    run,
    transactionHash,
    transactionUrl: verification.transaction.transactionUrl,
    verifiedTransaction: verification.transaction,
    workflowEvents: verification.events,
    mode: 'live',
  });
}
