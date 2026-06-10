import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { createGenericBuilderConfig, normalizeBuilderConfig } from '@/lib/shared/world-builder/defaults';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { getOfficialSdkAgent, mergeOfficialSdkAgent } from '@/lib/shared/sdk-agents';
import { slugifyRoute } from '@/lib/shared/routes';
import { AgentAssignmentError, assertAgentAssignableToWorld, clearAssignment, worldCountFromConfig } from '@/lib/server/agent-assignment';
import type { AgentSummary, AgentType, WorldBuilderConfig, WorldSummary } from '@/lib/shared/types';

interface Params {
  params: Promise<{ worldId: string }>;
}

function fallbackBuilder(worldId: string): WorldBuilderConfig {
  return createGenericBuilderConfig({
    name: worldId === 'glitchwoods' ? 'Glitchwoods Runtime' : 'World Runtime',
    slug: worldId,
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validAgentType(value: unknown): AgentType {
  return value === 'native_llm' || value === 'native_json_api' || value === 'native_web_parse' || value === 'reverie_custom'
    ? value
    : 'native_llm';
}

function formatDbAgent(agent: {
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
}): AgentSummary {
  const config = agent.config ?? {};
  return {
    id: agent.id,
    name: agent.name,
    type: agent.agent_type,
    description: agent.description ?? '',
    status: agent.status ?? 'ACTIVE',
    worldCount: worldCountFromConfig(config),
    createdAt: agent.created_at,
    systemPrompt: agent.system_prompt,
    config,
    isPublic: agent.is_public,
    isOwner: true,
    ownerId: agent.owner_id,
  };
}

function formatWorldSummary(world: {
  id: string;
  name: string;
  contract_address?: string | null;
  template_id?: string | null;
  world_state?: unknown;
  status?: WorldSummary['status'];
  sttt_balance?: number | string;
  created_at?: string;
}): WorldSummary {
  const state = objectValue(world.world_state);
  const agents = Array.isArray(state.agents) ? state.agents.filter((item): item is string => typeof item === 'string') : [];
  return {
    id: world.id,
    name: world.name,
    contractAddress: world.contract_address ?? '',
    template: typeof state.templateSlug === 'string' ? state.templateSlug : world.template_id ?? 'Custom',
    templateSlug: typeof state.templateSlug === 'string' ? state.templateSlug : 'custom',
    status: world.status ?? 'deployed',
    balance: `${world.sttt_balance ?? 0} STT`,
    activeAgents: agents.length,
    createdAt: world.created_at ?? new Date().toISOString(),
  };
}

function assignmentFor(world: { id: string; name: string; contract_address?: string | null }) {
  return {
    assignedWorldId: world.id,
    assignedWorldName: world.name,
    assignedWorldAddress: world.contract_address ?? '',
    worldAddress: world.contract_address ?? '',
  };
}

function replaceAgentNodeId(value: string, agentIdMap: Map<string, string>): string {
  if (!value.startsWith('agent:')) return value;
  const nextId = agentIdMap.get(value.slice('agent:'.length));
  return nextId ? `agent:${nextId}` : value;
}

async function materializeLocalBuilderAgents(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  world: { id: string; name: string; contract_address?: string | null; world_state?: unknown },
  builder: WorldBuilderConfig,
) {
  const agentIdMap = new Map<string, string>();
  const agentNameMap = new Map<string, string>();
  const createdAgents: AgentSummary[] = [];
  const state = objectValue(world.world_state);
  const templateName = typeof state.templateSlug === 'string' ? state.templateSlug : 'Template';
  const assignment = assignmentFor(world);
  const nextChain: WorldBuilderConfig['agentChain'] = [];

  for (const [index, step] of (builder.agentChain ?? []).entries()) {
    const localId = step.agentId ?? step.id;
    if (step.agentId || isUuid(localId) || getOfficialSdkAgent(localId)) {
      nextChain.push(step);
      continue;
    }

    const agentType = validAgentType(step.agentType);
    const agentName = `${step.name} (${templateName} Template - ${world.name} ${world.id.slice(0, 8)})`;
    const { data, error } = await supabase
      .from('agents')
      .insert({
        owner_id: userId,
        name: agentName,
        description: `${step.purpose} Created from the ${templateName} template for ${world.name}.`,
        agent_type: agentType,
        config: {
          status: 'ACTIVE',
          createdFromTemplate: true,
          sourceTemplateName: templateName,
          sourceTemplateAgentId: localId,
          sourceTemplateAgentOrder: index + 1,
          ...assignment,
          nativeAgentId: agentType,
          method: agentType,
          parameters: {
            purpose: step.purpose,
            inputTemplate: step.inputTemplate,
            urlTemplate: step.urlTemplate,
            selector: step.selector,
            resultAlias: step.resultAlias,
            contextTemplate: step.contextTemplate,
          },
          inputTemplate: step.inputTemplate,
          persistResult: Boolean(step.persistResult),
          persistOnChain: false,
        },
        system_prompt: step.purpose || step.inputTemplate || null,
        tool_calls: null,
        status: 'ACTIVE',
        is_public: false,
        updated_at: new Date().toISOString(),
      })
      .select('id,owner_id,name,agent_type,description,status,created_at,system_prompt,config,is_public')
      .single();
    if (error) throw error;

    const createdId = String(data.id);
    const createdName = String(data.name);
    agentIdMap.set(localId, createdId);
    agentNameMap.set(localId, createdName);
    createdAgents.push(formatDbAgent(data as {
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
    }));
    nextChain.push({ ...step, id: createdId, agentId: createdId, name: createdName, agentType });
  }

  if (agentIdMap.size === 0) return { builder, createdAgents };

  return {
    createdAgents,
    builder: {
      ...builder,
      agentChain: nextChain,
      triggers: (builder.triggers ?? []).map((trigger) => ({
        ...trigger,
        agentChain: trigger.agentChain.map((agentId) => agentIdMap.get(agentId) ?? agentId),
      })),
      graph: builder.graph
        ? {
            nodes: builder.graph.nodes.map((node) => {
              if (node.type !== 'agent') return node;
              const localId = node.refId ?? node.id.replace(/^agent:/, '');
              const nextId = agentIdMap.get(localId);
              if (!nextId) return node;
              return { ...node, id: `agent:${nextId}`, refId: nextId, label: agentNameMap.get(localId) ?? node.label };
            }),
            edges: builder.graph.edges.map((edge) => ({
              ...edge,
              source: replaceAgentNodeId(edge.source, agentIdMap),
              target: replaceAgentNodeId(edge.target, agentIdMap),
            })),
          }
        : builder.graph,
    },
  };
}

async function syncBuilderAgentAssignments(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  world: { id: string; name: string; contract_address?: string | null },
  builder: WorldBuilderConfig,
) {
  const desiredAgentIds = Array.from(new Set(
    (builder.agentChain ?? []).map((step) => step.agentId ?? step.id).filter(Boolean)
  ));
  const desired = new Set(desiredAgentIds);
  const assignment = assignmentFor(world);
  const updatedAgents: AgentSummary[] = [];

  const { data: userAgents } = await supabase
    .from('agents')
    .select('id,config')
    .eq('owner_id', userId);
  for (const agent of userAgents ?? []) {
    const config = objectValue(agent.config);
    const assignedHere = config.assignedWorldId === world.id;
    if (!desired.has(agent.id) && !assignedHere) continue;
    if (desired.has(agent.id)) assertAgentAssignableToWorld(config, world.id);
    const nextConfig = desired.has(agent.id)
      ? { ...config, ...assignment }
      : clearAssignment(config);
    if (!desired.has(agent.id) && nextConfig.persistOnChain) nextConfig.persistOnChain = false;
    const { data: updated } = await supabase
      .from('agents')
      .update({ config: nextConfig, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .eq('owner_id', userId)
      .select('id,owner_id,name,agent_type,description,status,created_at,system_prompt,config,is_public')
      .single();
    if (updated) {
      updatedAgents.push(formatDbAgent(updated as {
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
      }));
    }
  }

  const officialDesiredIds = desiredAgentIds.filter((id) => getOfficialSdkAgent(id));
  const { data: officialPrefs } = await supabase
    .from('user_sdk_agents')
    .select('sdk_agent_id,status,default_input,persist_on_chain')
    .eq('owner_id', userId);
  const existingOfficialIds = (officialPrefs ?? [])
    .filter((pref) => objectValue(pref.default_input).assignedWorldId === world.id)
    .map((pref) => String(pref.sdk_agent_id));

  for (const sdkAgentId of Array.from(new Set([...officialDesiredIds, ...existingOfficialIds]))) {
    const existing = (officialPrefs ?? []).find((pref) => pref.sdk_agent_id === sdkAgentId);
    const defaultInput = objectValue(existing?.default_input);
    const isDesired = desired.has(sdkAgentId);
    if (isDesired) assertAgentAssignableToWorld(defaultInput, world.id);
    const nextInput = isDesired
      ? { ...defaultInput, ...assignment }
      : clearAssignment(defaultInput);
    const { data: updatedPreference } = await supabase.from('user_sdk_agents').upsert({
      owner_id: userId,
      sdk_agent_id: sdkAgentId,
      status: existing?.status ?? getOfficialSdkAgent(sdkAgentId)?.status ?? 'INACTIVE',
      default_input: nextInput,
      persist_on_chain: isDesired ? Boolean(existing?.persist_on_chain) : false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,sdk_agent_id', ignoreDuplicates: false })
      .select('status,default_input,persist_on_chain')
      .single();
    const official = getOfficialSdkAgent(sdkAgentId);
    if (official && updatedPreference) updatedAgents.push(mergeOfficialSdkAgent(official, updatedPreference));
  }

  return { agentIds: desiredAgentIds, updatedAgents };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ builder: fallbackBuilder(worldId), source: 'demo' });
  }

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 });
  const state = world?.world_state && typeof world.world_state === 'object'
    ? world.world_state as Record<string, unknown>
    : {};
  const fallback = world
    ? createGenericBuilderConfig({ name: world.name, slug: slugifyRoute(world.name) || world.id })
    : fallbackBuilder(worldId);
  const builder = normalizeBuilderConfig((state.builder as WorldBuilderConfig | undefined) ?? fallback);
  return NextResponse.json({
    builder,
    world: formatWorldSummary(world),
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;
  const body = await req.json();
  const builder = normalizeBuilderConfig((body.builder ?? body) as WorldBuilderConfig);

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ builder, source: 'demo' });
  }

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to resolve user' }, { status: 500 });
  const current = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!current) return NextResponse.json({ error: 'World not found' }, { status: 404 });
  const currentState = current.world_state && typeof current.world_state === 'object'
    ? current.world_state as Record<string, unknown>
    : {};
  const materialized = await materializeLocalBuilderAgents(supabase, userId, current, builder);
  let syncedAgents;
  try {
    syncedAgents = await syncBuilderAgentAssignments(supabase, userId, current, materialized.builder);
  } catch (error) {
    if (error instanceof AgentAssignmentError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  const worldState = { ...currentState, agents: syncedAgents.agentIds, builder: materialized.builder };
  const { data, error } = await supabase
    .from('worlds')
    .update({ world_state: worldState, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select('id,name,contract_address,template_id,world_state,status,sttt_balance,created_at')
    .single();

  if (error) return NextResponse.json({ error: 'Failed to save builder config' }, { status: 500 });
  return NextResponse.json({
    builder: (data.world_state as Record<string, unknown>).builder,
    world: formatWorldSummary(data),
    createdAgents: materialized.createdAgents,
    updatedAgents: syncedAgents.updatedAgents,
  });
}
