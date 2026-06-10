import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import type { AgentType } from '@/lib/shared/types';
import { getOfficialSdkAgent, mergeOfficialSdkAgent, officialSdkAgents } from '@/lib/shared/sdk-agents';
import { objectValue, worldCountFromConfig } from '@/lib/server/agent-assignment';
import { assignedWorldsForAgent, buildAgentUsageById, type AgentWorldUsage } from '@/lib/server/agent-world-usage';

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

function formatDbAgent(agent: DbAgent, userId: string, assignedWorlds?: AgentWorldUsage[]) {
  const config = objectValue(agent.config);
  const worldAssignments = assignedWorlds && assignedWorlds.length > 0 ? assignedWorlds : [];
  return {
    id: agent.id,
    name: agent.name,
    type: agent.agent_type,
    description: agent.description ?? '',
    status: agent.status ?? (agent.config as { status?: 'ACTIVE' | 'INACTIVE' } | null)?.status ?? 'ACTIVE',
    worldCount: worldAssignments.length || worldCountFromConfig(config),
    createdAt: agent.created_at,
    systemPrompt: agent.system_prompt,
    config,
    isPublic: agent.is_public,
    isOwner: agent.owner_id === userId,
    ownerId: agent.owner_id,
    assignedWorlds: worldAssignments,
  };
}

function missingStatusColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && error.code === 'PGRST204' && error.message?.includes("'status' column"));
}

function withoutStatus<T extends { status?: unknown }>(value: T): Omit<T, 'status'> {
  const copy = { ...value };
  delete copy.status;
  return copy;
}

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasSupabaseAdminEnv()) return NextResponse.json({ agents: officialSdkAgents, source: 'sdk' });

    const supabase = createAdminSupabaseClient();

    const userId = await ensureSupabaseUser(session);

    if (!userId) return NextResponse.json({ agents: officialSdkAgents, source: 'sdk' });

    const { data: worlds } = await supabase
      .from('worlds')
      .select('id,name,contract_address,world_state')
      .eq('owner_id', userId);

    const usageById = buildAgentUsageById((worlds ?? []) as Array<{ id: string; name: string; contract_address?: string | null; world_state?: unknown }>);

    const { data: officialPrefs } = await supabase
      .from('user_sdk_agents')
      .select('sdk_agent_id,status,default_input,persist_on_chain')
      .eq('owner_id', userId);

    const preferenceById = new Map((officialPrefs ?? []).map((pref) => [pref.sdk_agent_id, pref]));
    const official = officialSdkAgents.map((agent) => {
      const merged = mergeOfficialSdkAgent(agent, preferenceById.get(agent.id));
      const assignedWorlds = usageById.get(agent.id) ?? assignedWorldsForAgent(agent.id, (worlds ?? []) as Array<{ id: string; name: string; contract_address?: string | null; world_state?: unknown }>);
      return {
        ...merged,
        worldCount: assignedWorlds.length,
        assignedWorlds,
      };
    });

    const { data: agents, error } = await supabase
      .from('agents')
      .select('*')
      .or(`owner_id.eq.${userId},is_public.eq.true`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formatted = (agents ?? []).map((agent) => formatDbAgent(
      agent as DbAgent,
      userId,
      usageById.get((agent as DbAgent).id) ?? assignedWorldsForAgent((agent as DbAgent).id, (worlds ?? []) as Array<{ id: string; name: string; contract_address?: string | null; world_state?: unknown }>),
    ));

    return NextResponse.json({ agents: [...official, ...formatted] });
  } catch (err) {
    console.error('GET /api/agents error:', err);
    return NextResponse.json({ agents: officialSdkAgents, source: 'sdk' });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: true, source: 'demo' });
    const { name, agentType, description, config, systemPrompt, toolCalls, isPublic, cloneFromAgentId, status } = body;

    if (!cloneFromAgentId && (!name || !agentType)) {
      return NextResponse.json({ error: 'name and agentType are required' }, { status: 400 });
    }

    if (!hasSupabaseAdminEnv()) {
      if (cloneFromAgentId) {
        const officialSource = getOfficialSdkAgent(cloneFromAgentId);
        if (!officialSource) return NextResponse.json({ error: 'Supabase is required to copy public agents' }, { status: 503 });
        const copyName = name ?? `${officialSource.name} Copy`;
        return NextResponse.json({
          agent: {
            id: copyName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: copyName,
            type: agentType ?? officialSource.type,
            description: description ?? officialSource.description,
            status: status ?? 'ACTIVE',
            worldCount: 0,
            createdAt: new Date().toISOString(),
            config: { ...(officialSource.config ?? {}), ...(config ?? {}), clonedFromOfficial: officialSource.id },
            systemPrompt: systemPrompt ?? officialSource.systemPrompt ?? null,
            isPublic: Boolean(isPublic),
            isOwner: true,
          },
          source: 'demo-official-copy',
        }, { status: 201 });
      }
      return NextResponse.json({
        agent: {
          id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name,
          type: agentType as AgentType,
          description: description ?? '',
          status: status ?? 'ACTIVE',
          worldCount: 0,
          createdAt: new Date().toISOString(),
          config: config ?? {},
          systemPrompt: systemPrompt ?? null,
          isPublic: Boolean(isPublic),
          isOwner: true,
        },
        source: 'demo',
      }, { status: 201 });
    }

    const supabase = createAdminSupabaseClient();
    const userId = await ensureSupabaseUser(session);
    if (!userId) {
      if (cloneFromAgentId) return NextResponse.json({ error: 'Unable to create user for copy' }, { status: 500 });
      return NextResponse.json({
        agent: {
          id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name,
          type: agentType as AgentType,
          description: description ?? '',
          status: status ?? 'ACTIVE',
          worldCount: 0,
          createdAt: new Date().toISOString(),
          config: config ?? {},
          systemPrompt: systemPrompt ?? null,
          isPublic: Boolean(isPublic),
          isOwner: true,
        },
        source: 'demo',
      }, { status: 201 });
    }

    if (cloneFromAgentId) {
      const officialSource = getOfficialSdkAgent(cloneFromAgentId);
      if (officialSource) {
        const copyPayload = {
          owner_id: userId,
          name: name ?? `${officialSource.name} Copy`,
          agent_type: agentType ?? officialSource.type,
          description: description ?? officialSource.description,
          config: {
            ...(officialSource.config ?? {}),
            ...(config ?? {}),
            clonedFromOfficial: officialSource.id,
            status: status ?? 'ACTIVE',
          },
          system_prompt: systemPrompt ?? officialSource.systemPrompt ?? null,
          tool_calls: toolCalls ?? null,
          status: status ?? 'ACTIVE',
          is_public: Boolean(isPublic),
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

        if (copyError) throw copyError;
        return NextResponse.json({ agent: formatDbAgent(copy as DbAgent, userId), source: 'official-copy' }, { status: 201 });
      }

      const { data: source, error: sourceError } = await supabase
        .from('agents')
        .select('*')
        .eq('id', cloneFromAgentId)
        .eq('is_public', true)
        .maybeSingle();

      if (sourceError || !source) return NextResponse.json({ error: 'Public agent not found' }, { status: 404 });

      const copyName = `${source.name} Copy`;
      const copyPayload = {
        owner_id: userId,
        name: copyName,
        agent_type: source.agent_type,
        description: source.description,
        config: { ...(source.config ?? {}), status: status ?? 'ACTIVE' },
        system_prompt: source.system_prompt,
        tool_calls: source.tool_calls,
        status: status ?? 'ACTIVE',
        is_public: false,
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

      if (copyError) throw copyError;
      return NextResponse.json({ agent: formatDbAgent(copy as DbAgent, userId), source: 'copy' }, { status: 201 });
    }

    const agentPayload = {
      owner_id: userId,
      name,
      agent_type: agentType,
      description: description ?? null,
      config: { ...(config ?? {}), status: status ?? 'ACTIVE' },
      system_prompt: systemPrompt ?? null,
      tool_calls: toolCalls ?? null,
      status: status ?? 'ACTIVE',
      is_public: Boolean(isPublic),
      updated_at: new Date().toISOString(),
    };
    let { data: agent, error } = await supabase
      .from('agents')
      .upsert(agentPayload, { onConflict: 'owner_id,name', ignoreDuplicates: false })
      .select()
      .single();
    if (missingStatusColumn(error)) {
      const retry = await supabase
        .from('agents')
        .upsert(withoutStatus(agentPayload), { onConflict: 'owner_id,name', ignoreDuplicates: false })
        .select()
        .single();
      agent = retry.data;
      error = retry.error;
    }

    if (error) throw error;

    return NextResponse.json({ agent: formatDbAgent(agent as DbAgent, userId) }, { status: 201 });
  } catch (err) {
    console.error('POST /api/agents error:', err);
    return NextResponse.json({ error: 'Failed to save agent' }, { status: 500 });
  }
}
