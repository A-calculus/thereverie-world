import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { getOfficialSdkAgent, mergeOfficialSdkAgent } from '@/lib/shared/sdk-agents';
import type { AgentType } from '@/lib/shared/types';
import { objectValue, worldCountFromConfig } from '@/lib/server/agent-assignment';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

interface Params {
  params: Promise<{ agentId: string }>;
}

type DbAgent = {
  id: string;
  owner_id: string;
  name: string;
  agent_type: AgentType;
  description: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  system_prompt: string | null;
  config: Record<string, unknown> | null;
  is_public: boolean;
};

function formatDbAgent(agent: DbAgent, userId: string) {
  const config = objectValue(agent.config);
  return {
    id: agent.id,
    name: agent.name,
    type: agent.agent_type,
    description: agent.description ?? '',
    status: agent.status ?? (agent.config as { status?: 'ACTIVE' | 'INACTIVE' } | null)?.status ?? 'ACTIVE',
    worldCount: worldCountFromConfig(config),
    createdAt: agent.created_at,
    systemPrompt: agent.system_prompt,
    config,
    isPublic: agent.is_public,
    isOwner: agent.owner_id === userId,
    ownerId: agent.owner_id,
  };
}

function missingStatusColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && error.code === 'PGRST204' && error.message?.includes("'status' column"));
}

function missingRelation(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === 'PGRST205' || error.code === '42P01'));
}

function withoutStatus<T extends { status?: unknown }>(value: T): Omit<T, 'status'> {
  const copy = { ...value };
  delete copy.status;
  return copy;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { agentId } = await params;
  const officialAgent = getOfficialSdkAgent(agentId);

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ agent: officialAgent ?? null, source: officialAgent ? 'sdk' : 'demo' });
  }

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);

  if (officialAgent) {
    if (!userId) return NextResponse.json({ agent: officialAgent, source: 'sdk' });
    const { data: preference } = await supabase
      .from('user_sdk_agents')
      .select('status,default_input,persist_on_chain')
      .eq('owner_id', userId)
      .eq('sdk_agent_id', officialAgent.id)
      .maybeSingle();
    return NextResponse.json({ agent: mergeOfficialSdkAgent(officialAgent, preference), source: 'sdk' });
  }

  if (!isUuid(agentId) || !userId) return NextResponse.json({ agent: null, source: 'none' }, { status: 404 });

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .or(`owner_id.eq.${userId},is_public.eq.true`)
    .maybeSingle();

  if (error || !data) return NextResponse.json({ agent: null, source: 'none' }, { status: 404 });

  return NextResponse.json({ agent: formatDbAgent(data as DbAgent, userId) });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { agentId } = await params;
  const body = await req.json();
  const officialAgent = getOfficialSdkAgent(agentId);

  if (!hasSupabaseAdminEnv()) return NextResponse.json({ agent: { ...body, id: agentId }, source: officialAgent ? 'sdk' : 'demo' });

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to resolve user' }, { status: 500 });

  if (officialAgent) {
    const { data, error } = await supabase
      .from('user_sdk_agents')
      .upsert({
        owner_id: userId,
        sdk_agent_id: officialAgent.id,
        status: body.status ?? 'ACTIVE',
        default_input: body.defaultInput ?? {},
        persist_on_chain: Boolean(body.persistOnChain),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_id,sdk_agent_id', ignoreDuplicates: false })
      .select('status,default_input,persist_on_chain')
      .single();

    if (missingRelation(error)) {
      return NextResponse.json({
        agent: mergeOfficialSdkAgent(officialAgent, {
          status: body.status ?? 'ACTIVE',
          default_input: body.defaultInput ?? {},
          persist_on_chain: Boolean(body.persistOnChain),
        }),
        source: 'sdk-fallback',
      });
    }
    if (error) return NextResponse.json({ error: 'Failed to update SDK agent settings' }, { status: 500 });
    return NextResponse.json({ agent: mergeOfficialSdkAgent(officialAgent, data), source: 'sdk' });
  }

  if (!isUuid(agentId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const { data: existing } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  if (existing.owner_id !== userId) {
    if (!existing.is_public) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const copyPayload = {
      owner_id: userId,
      name: body.name ?? `${existing.name} Copy`,
      description: body.description ?? existing.description,
      agent_type: existing.agent_type,
      system_prompt: body.systemPrompt ?? existing.system_prompt,
      config: { ...(body.config ?? existing.config ?? {}), status: body.status ?? 'ACTIVE' },
      tool_calls: existing.tool_calls,
      status: body.status ?? 'ACTIVE',
      is_public: Boolean(body.isPublic),
      updated_at: new Date().toISOString(),
    };
    let { data: copy, error: copyError } = await supabase
      .from('agents')
      .upsert(copyPayload, { onConflict: 'owner_id,name', ignoreDuplicates: false })
      .select()
      .single();
    if (missingStatusColumn(copyError)) {
      const retry = await supabase
        .from('agents')
        .upsert(withoutStatus(copyPayload), { onConflict: 'owner_id,name', ignoreDuplicates: false })
        .select()
        .single();
      copy = retry.data;
      copyError = retry.error;
    }

    if (copyError) return NextResponse.json({ error: 'Failed to copy public agent' }, { status: 500 });
    return NextResponse.json({ agent: formatDbAgent(copy as DbAgent, userId), source: 'copy' });
  }

  const updatePayload = {
    name: body.name,
    description: body.description,
    system_prompt: body.systemPrompt,
    config: { ...(body.config ?? {}), status: body.status ?? 'ACTIVE' },
    status: body.status ?? 'ACTIVE',
    is_public: body.isPublic ?? false,
    updated_at: new Date().toISOString(),
  };
  let { data, error } = await supabase
    .from('agents')
    .update(updatePayload)
    .eq('id', agentId)
    .select()
    .single();
  if (missingStatusColumn(error)) {
    const retry = await supabase
      .from('agents')
      .update(withoutStatus(updatePayload))
      .eq('id', agentId)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  return NextResponse.json({ agent: formatDbAgent(data as DbAgent, userId) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { agentId } = await params;

  if (!hasSupabaseAdminEnv() || !isUuid(agentId)) return NextResponse.json({ success: true, deletedId: agentId, source: 'official' });

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to resolve user' }, { status: 500 });
  const { error } = await supabase.from('agents').delete().eq('id', agentId).eq('owner_id', userId);
  if (error) return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  return NextResponse.json({ success: true, deletedId: agentId });
}
