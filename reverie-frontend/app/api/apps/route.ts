import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { demoWorlds } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv, resolveTemplateId } from '@/lib/server/supabase';
import { getTemplateBuilderConfig, normalizeBuilderConfig } from '@/lib/shared/world-builder/defaults';
import { slugifyRoute } from '@/lib/shared/routes';
import { getOfficialSdkAgent, mergeOfficialSdkAgent } from '@/lib/shared/sdk-agents';
import { AgentAssignmentError, assertAgentAssignableToWorld, worldCountFromConfig } from '@/lib/server/agent-assignment';
import { ensureOfficialTemplatesSeeded, mergeOfficialTemplateConfig } from '@/lib/server/official-templates';
import type { AgentSummary, AgentType, FeedType, TriggerSourceConfig, WorldBuilderConfig, WorldBuilderTrigger } from '@/lib/shared/types';

type TemplateRecord = {
  id: string;
  slug: string;
  name: string;
  world_config?: unknown;
};

type DbWorldRecord = {
  id: string;
  name: string;
  contract_address: string;
  status: string;
  sttt_balance: string | number;
  created_at: string;
  world_state: unknown;
};

type BuilderZone = NonNullable<WorldBuilderConfig['zones']>[number];
type BuilderFaction = NonNullable<WorldBuilderConfig['factions']>[number];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStringArray(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function objectArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item): item is T => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
}

function mergeById<T extends { id: string }>(base: T[], additions: T[]): T[] {
  const seen = new Set(base.map((item) => item.id));
  return [
    ...base,
    ...additions
      .map((item, index) => ({ ...item, id: item.id || `item-${index + 1}` }))
      .filter((item) => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }),
  ];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validAgentType(value: unknown): AgentType {
  return value === 'native_llm' || value === 'native_json_api' || value === 'native_web_parse' || value === 'reverie_custom'
    ? value
    : 'native_llm';
}

function formatCreatedTemplateAgent(agent: {
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
  const config = objectValue(agent.config);
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

function dedupeAgentChain(chain: WorldBuilderConfig['agentChain']): WorldBuilderConfig['agentChain'] {
  const seen = new Set<string>();
  return chain.filter((step) => {
    const key = step.agentId ?? step.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function agentIdsFromBuilder(builder: WorldBuilderConfig | undefined): string[] {
  return uniqueStringArray((builder?.agentChain ?? []).map((step) => step.agentId ?? step.id).filter(Boolean));
}

function replaceAgentNodeId(value: string, agentIdMap: Map<string, string>): string {
  if (!value.startsWith('agent:')) return value;
  const localId = value.slice('agent:'.length);
  const nextId = agentIdMap.get(localId);
  return nextId ? `agent:${nextId}` : value;
}

function rewriteBuilderAgentRefs(
  builder: WorldBuilderConfig,
  agentIdMap: Map<string, string>,
  agentNameMap: Map<string, string>,
): WorldBuilderConfig {
  if (agentIdMap.size === 0) {
    return { ...builder, agentChain: dedupeAgentChain(builder.agentChain ?? []) };
  }

  return {
    ...builder,
    agentChain: dedupeAgentChain(builder.agentChain ?? []),
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
            return {
              ...node,
              id: `agent:${nextId}`,
              refId: nextId,
              label: agentNameMap.get(localId) ?? node.label,
            };
          }),
          edges: builder.graph.edges.map((edge) => ({
            ...edge,
            source: replaceAgentNodeId(edge.source, agentIdMap),
            target: replaceAgentNodeId(edge.target, agentIdMap),
          })),
        }
      : builder.graph,
  };
}

function replaceTriggerId(value: string, triggerIdMap: Map<string, string>): string {
  let next = value;
  for (const [oldId, newId] of triggerIdMap.entries()) {
    next = next.split(oldId).join(newId);
  }
  return next;
}

function rewriteBuilderTriggerRefs(builder: WorldBuilderConfig, triggerIdMap: Map<string, string>): WorldBuilderConfig {
  if (triggerIdMap.size === 0) return builder;
  return {
    ...builder,
    triggers: (builder.triggers ?? []).map((trigger) => {
      const nextId = triggerIdMap.get(trigger.id) ?? trigger.id;
      return {
        ...trigger,
        id: nextId,
        nextTriggerIds: (trigger.nextTriggerIds ?? []).map((id) => triggerIdMap.get(id) ?? id),
      };
    }),
    manualActions: (builder.manualActions ?? []).map((action) => ({
      ...action,
      triggerId: action.triggerId ? triggerIdMap.get(action.triggerId) ?? action.triggerId : action.triggerId,
    })),
    graph: builder.graph
      ? {
          nodes: builder.graph.nodes.map((node) => ({
            ...node,
            id: replaceTriggerId(node.id, triggerIdMap),
            refId: node.refId ? triggerIdMap.get(node.refId) ?? node.refId : node.refId,
          })),
          edges: builder.graph.edges.map((edge) => ({
            ...edge,
            id: replaceTriggerId(edge.id, triggerIdMap),
            source: replaceTriggerId(edge.source, triggerIdMap),
            target: replaceTriggerId(edge.target, triggerIdMap),
          })),
        }
      : builder.graph,
  };
}

function feedTypeForTrigger(trigger: WorldBuilderTrigger): FeedType {
  const sourceConfig = trigger.sourceConfig as TriggerSourceConfig | undefined;
  if (sourceConfig?.kind === 'schedule_time') return 'time';
  if (sourceConfig?.kind === 'data_source') return 'web_scrape';
  return 'time';
}

async function materializeBuilderTriggers(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>;
  world: DbWorldRecord;
  builder: WorldBuilderConfig;
}) {
  const triggerIdMap = new Map<string, string>();
  for (const trigger of params.builder.triggers ?? []) {
    const condition = objectValue(trigger.condition);
    const sourceConfig = objectValue(trigger.sourceConfig ?? condition.sourceConfig);
    const typeConfig = objectValue(trigger.typeConfig ?? condition.typeConfig);
    const payload = {
      world_id: params.world.id,
      feed_type: feedTypeForTrigger(trigger),
      feed_config: { name: trigger.name },
      condition: {
        ...condition,
        name: trigger.name,
        label: trigger.conditionLabel ?? condition.label ?? 'IF condition is true',
        triggerType: trigger.type,
        agentName: trigger.agentChain?.length ? `${trigger.agentChain.length} chained agents` : 'Agent Chain',
        graphNodeId: `trigger:${trigger.id}`,
        chain: trigger.agentChain ?? [],
        inputParser: trigger.inputParser ?? (typeof condition.inputParser === 'string' ? condition.inputParser : ''),
        isStartTrigger: Boolean(trigger.condition?.isStartTrigger ?? condition.isStartTrigger),
        graphPosition: trigger.graphPosition ?? condition.graphPosition,
        sourceConfig,
        typeConfig,
        outputMapping: trigger.outputMapping ?? condition.outputMapping ?? [],
        nextTriggerIds: trigger.nextTriggerIds ?? condition.nextTriggerIds ?? [],
      },
      execution_lane: trigger.executionLane ?? condition.executionLane ?? 'sdk',
      cooldown_ms: trigger.cooldownMs ?? condition.cooldownMs ?? 0,
      is_active: trigger.isActive,
    };
    const { data, error } = await params.supabase
      .from('triggers')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw error;
    triggerIdMap.set(trigger.id, String(data.id));
  }
  return rewriteBuilderTriggerRefs(params.builder, triggerIdMap);
}

async function assignExistingAgentsToWorld(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  world: DbWorldRecord;
  agentIds: string[];
  skipAgentIds?: string[];
}) {
  const assignedAgents: AgentSummary[] = [];
  const skipIds = new Set(params.skipAgentIds ?? []);
  const assignment = {
    assignedWorldId: params.world.id,
    assignedWorldName: params.world.name,
    assignedWorldAddress: params.world.contract_address,
    worldAddress: params.world.contract_address,
  };

  for (const agentId of uniqueStringArray(params.agentIds)) {
    if (skipIds.has(agentId)) continue;
    const officialAgent = getOfficialSdkAgent(agentId);
    if (officialAgent) {
      const { data: existingPreference, error: existingPreferenceError } = await params.supabase
        .from('user_sdk_agents')
        .select('default_input')
        .eq('owner_id', params.userId)
        .eq('sdk_agent_id', officialAgent.id)
        .maybeSingle();
      if (existingPreferenceError) throw existingPreferenceError;
      assertAgentAssignableToWorld(objectValue(existingPreference?.default_input), params.world.id);
      const { data, error } = await params.supabase
        .from('user_sdk_agents')
        .upsert({
          owner_id: params.userId,
          sdk_agent_id: officialAgent.id,
          status: 'ACTIVE',
          default_input: assignment,
          persist_on_chain: false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'owner_id,sdk_agent_id', ignoreDuplicates: false })
        .select('status,default_input,persist_on_chain')
        .single();
      if (error) throw error;
      assignedAgents.push(mergeOfficialSdkAgent(officialAgent, data));
      continue;
    }

    if (!isUuid(agentId)) continue;
    const { data: existing, error: existingError } = await params.supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('owner_id', params.userId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) continue;

    const currentConfig = objectValue(existing.config);
    assertAgentAssignableToWorld(currentConfig, params.world.id);
    const { data: updated, error: updateError } = await params.supabase
      .from('agents')
      .update({
        config: {
          ...currentConfig,
          ...assignment,
          status: existing.status ?? currentConfig.status ?? 'ACTIVE',
        },
        status: existing.status ?? 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId)
      .eq('owner_id', params.userId)
      .select('id,owner_id,name,agent_type,description,status,created_at,system_prompt,config,is_public')
      .single();
    if (updateError) throw updateError;
    assignedAgents.push(formatCreatedTemplateAgent(updated as {
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

  return assignedAgents;
}

async function assertExistingAgentsUnassigned(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  agentIds: string[];
}) {
  for (const agentId of uniqueStringArray(params.agentIds)) {
    const officialAgent = getOfficialSdkAgent(agentId);
    if (officialAgent) {
      const { data: existingPreference, error } = await params.supabase
        .from('user_sdk_agents')
        .select('default_input')
        .eq('owner_id', params.userId)
        .eq('sdk_agent_id', officialAgent.id)
        .maybeSingle();
      if (error) throw error;
      const assignedWorld = objectValue(existingPreference?.default_input).assignedWorldId;
      if (typeof assignedWorld === 'string' && assignedWorld) {
        assertAgentAssignableToWorld(objectValue(existingPreference?.default_input), '__new_world__');
      }
      continue;
    }

    if (!isUuid(agentId)) continue;
    const { data: existing, error } = await params.supabase
      .from('agents')
      .select('config')
      .eq('id', agentId)
      .eq('owner_id', params.userId)
      .maybeSingle();
    if (error) throw error;
    const assignedWorld = objectValue(existing?.config).assignedWorldId;
    if (typeof assignedWorld === 'string' && assignedWorld) {
      assertAgentAssignableToWorld(objectValue(existing?.config), '__new_world__');
    }
  }
}

async function loadTemplateCopyConfig(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  templateId: string | null | undefined,
  userId: string,
) {
  if (!templateId || templateId === 'void' || templateId === 'blank') return null;
  const { data } = await supabase
    .from('templates')
    .select('*')
    .or(`id.eq.${templateId},slug.eq.${templateId},name.eq.${templateId}`)
    .or(`creator_id.is.null,creator_id.eq.${userId}`)
    .maybeSingle();
  return data ? mergeOfficialTemplateConfig(data) : null;
}

async function materializeTemplateAgents(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  world: DbWorldRecord;
  templateRecord: TemplateRecord | null;
  builder: WorldBuilderConfig;
}) {
  const agentIdMap = new Map<string, string>();
  const agentNameMap = new Map<string, string>();
  const createdAgentIds: string[] = [];
  const createdAgents: AgentSummary[] = [];
  const templateName = params.templateRecord?.name ?? params.builder.displayName ?? 'World';
  const templateSlug = params.templateRecord?.slug ?? params.builder.config?.sourceTemplateSlug ?? 'custom';
  const shortWorldId = params.world.id.slice(0, 8);
  const agentChain = dedupeAgentChain(params.builder.agentChain ?? []);
  const nextChain: WorldBuilderConfig['agentChain'] = [];

  for (const [index, step] of agentChain.entries()) {
    const localId = step.id;
    if (step.agentId || isUuid(localId)) {
      nextChain.push(step);
      continue;
    }

    const agentType = validAgentType(step.agentType);
    const agentName = `${step.name} (${templateName} Template - ${params.world.name} ${shortWorldId})`;
    const config = {
      status: 'ACTIVE',
      createdFromTemplate: true,
      sourceTemplateId: params.templateRecord?.id ?? null,
      sourceTemplateSlug: templateSlug,
      sourceTemplateName: templateName,
      sourceTemplateAgentId: localId,
      sourceTemplateAgentOrder: index + 1,
      assignedWorldId: params.world.id,
      assignedWorldName: params.world.name,
      assignedWorldAddress: params.world.contract_address,
      worldAddress: params.world.contract_address,
      nativeAgentId: agentType,
      method: agentType,
      parameters: {
        purpose: step.purpose,
        inputTemplate: step.inputTemplate,
      },
      inputTemplate: step.inputTemplate,
      persistResult: Boolean(step.persistResult),
      persistOnChain: false,
    };

    const { data: agent, error } = await params.supabase
      .from('agents')
      .insert({
        owner_id: params.userId,
        name: agentName,
        description: `${step.purpose} Created from the ${templateName} template for ${params.world.name}.`,
        agent_type: agentType,
        config,
        system_prompt: step.purpose || step.inputTemplate || null,
        tool_calls: null,
        status: 'ACTIVE',
        is_public: false,
        updated_at: new Date().toISOString(),
      })
      .select('id,owner_id,name,agent_type,description,status,created_at,system_prompt,config,is_public')
      .single();

    if (error) throw error;
    const createdId = String(agent.id);
    const createdName = String(agent.name);
    agentIdMap.set(localId, createdId);
    agentNameMap.set(localId, createdName);
    createdAgentIds.push(createdId);
    createdAgents.push(formatCreatedTemplateAgent(agent as {
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
    nextChain.push({
      ...step,
      id: createdId,
      agentId: createdId,
      name: createdName,
      agentType: validAgentType(agent.agent_type),
    });
  }

  const builder = rewriteBuilderAgentRefs({ ...params.builder, agentChain: nextChain }, agentIdMap, agentNameMap);
  return { builder, createdAgentIds, createdAgents };
}

function buildCopiedWorldState(params: {
  name: string;
  templateId?: string | null;
  templateRecord?: TemplateRecord | null;
  requestedWorldState?: unknown;
  savedAt?: string;
}) {
  const requestedState = objectValue(params.requestedWorldState);
  const templateConfig = objectValue(params.templateRecord?.world_config);
  const copiedState = objectValue(templateConfig.worldState ?? templateConfig);
  const sourceBuilder = objectValue(copiedState.builder ?? templateConfig.builder);
  const requestedBuilder = objectValue(requestedState.builder);
  const templateSlug = params.templateRecord?.slug ?? params.templateId ?? 'blank';
  const worldSlug = slugifyRoute(params.name);
  const requestedAgents = stringArray(requestedState.agents);
  const builder = normalizeBuilderConfig(
    Object.keys(sourceBuilder).length > 0
      ? sourceBuilder as unknown as WorldBuilderConfig
      : getTemplateBuilderConfig(templateSlug === 'void' ? 'blank' : templateSlug, params.name)
  );
  const requestedZones = objectArray<BuilderZone>(requestedState.zones);
  const requestedFactions = objectArray<BuilderFaction>(requestedState.factions);
  const mergedZones = mergeById(
    objectArray<BuilderZone>(copiedState.zones ?? builder.zones),
    requestedZones,
  );
  const mergedFactions = mergeById(
    objectArray<BuilderFaction>(copiedState.factions ?? builder.factions),
    requestedFactions,
  );
  const requestedAgentChain = Array.isArray(requestedBuilder.agentChain)
    ? requestedBuilder.agentChain as WorldBuilderConfig['agentChain']
    : [];

  builder.displayName = params.name;
  builder.uiSlug = worldSlug;
  builder.lastPublishedAt = params.savedAt ?? builder.lastPublishedAt;
  builder.config = {
    ...(builder.config ?? {}),
    worldSlug,
    sourceTemplateId: params.templateRecord?.id ?? params.templateId ?? null,
    sourceTemplateSlug: templateSlug,
  };
  builder.zones = mergedZones;
  builder.factions = mergedFactions;
  if (requestedAgentChain.length > 0) {
    builder.agentChain = dedupeAgentChain([
      ...(builder.agentChain ?? []),
      ...(requestedAgentChain as WorldBuilderConfig['agentChain']),
    ]);
  }

  return {
    ...copiedState,
    ...requestedState,
    template: params.templateRecord?.id ?? params.templateId ?? 'blank',
    templateSlug,
    worldSlug,
    agents: requestedAgents,
    zones: mergedZones,
    factions: mergedFactions,
    entities: Array.isArray(requestedState.entities) ? requestedState.entities : copiedState.entities ?? [],
    builder,
  };
}

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasSupabaseAdminEnv()) return NextResponse.json({ worlds: demoWorlds, source: 'demo' });

    const supabase = createAdminSupabaseClient();
    await ensureOfficialTemplatesSeeded();
    const userId = await ensureSupabaseUser(session);

    if (!userId) return NextResponse.json({ worlds: [] });

    const { data: worlds, error } = await supabase
      .from('worlds')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formatted = (worlds ?? []).map((w) => {
      const state = objectValue(w.world_state);
      const builder = objectValue(state.builder) as unknown as WorldBuilderConfig;
      const agents = uniqueStringArray([...stringArray(state.agents), ...agentIdsFromBuilder(builder)]);
      return {
        id: w.id,
        name: w.name,
        contractAddress: w.contract_address,
        template: typeof state.templateSlug === 'string' ? state.templateSlug : w.template_id ?? 'Custom',
        templateSlug: typeof state.templateSlug === 'string' ? state.templateSlug : 'custom',
        status: w.status,
        balance: `${w.sttt_balance} STT`,
        activeAgents: agents.length,
        createdAt: w.created_at,
      };
    });

    return NextResponse.json({ worlds: formatted });
  } catch (err) {
    console.error('GET /api/apps error:', err);
    return NextResponse.json({ error: 'Failed to load worlds' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: true, source: 'demo' });
    const { name, contractAddress, templateId, worldState } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({
        world: {
          id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name,
          contractAddress: contractAddress ?? '',
          template: templateId ?? 'custom',
          templateSlug: templateId ?? 'custom',
          status: 'draft',
          balance: '0 STT',
          activeAgents: 0,
          createdAt: new Date().toISOString(),
        },
        source: 'demo',
      }, { status: 201 });
    }

    const supabase = createAdminSupabaseClient();
    const userId = await ensureSupabaseUser(session);
    if (!userId) {
      return NextResponse.json({ error: 'Unable to resolve user' }, { status: 500 });
    }
    const templateRecord = await loadTemplateCopyConfig(supabase, templateId, userId);
    const resolvedTemplateId = templateRecord?.id ?? await resolveTemplateId(templateId);
    const createdAt = new Date().toISOString();
    const copiedWorldState = buildCopiedWorldState({ name, templateId, templateRecord, requestedWorldState: worldState, savedAt: createdAt });
    await assertExistingAgentsUnassigned({ supabase, userId, agentIds: stringArray(copiedWorldState.agents) });

    const { data: world, error } = await supabase
      .from('worlds')
      .insert({
        owner_id: userId,
        name,
        contract_address: contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000' ? contractAddress : null,
        template_id: resolvedTemplateId,
        world_state: copiedWorldState,
        agents: copiedWorldState.agents,
        status: 'draft',
        sttt_balance: 0,
        updated_at: createdAt,
      })
      .select()
      .single();

    if (error?.code === '23505') return NextResponse.json({ error: 'A world with this name already exists. Choose a unique name.' }, { status: 409 });
    if (error) throw error;

    const materialized = await materializeTemplateAgents({
      supabase,
      userId,
      world: world as DbWorldRecord,
      templateRecord,
      builder: copiedWorldState.builder as WorldBuilderConfig,
    });
    const finalAgentIds = uniqueStringArray([
      ...materialized.createdAgentIds,
      ...stringArray(copiedWorldState.agents),
      ...agentIdsFromBuilder(materialized.builder),
    ]);
    const assignedExistingAgents = await assignExistingAgentsToWorld({
      supabase,
      userId,
      world: world as DbWorldRecord,
      agentIds: stringArray(copiedWorldState.agents),
      skipAgentIds: materialized.createdAgentIds,
    });
    const builderWithTriggers = await materializeBuilderTriggers({
      supabase,
      world: world as DbWorldRecord,
      builder: materialized.builder,
    });
    const finalWorldState = {
      ...copiedWorldState,
      builder: builderWithTriggers,
      agents: uniqueStringArray([...finalAgentIds, ...agentIdsFromBuilder(builderWithTriggers)]),
    };
    const persistedAgentIds = stringArray(finalWorldState.agents);
    const { data: updatedWorld, error: updateError } = await supabase
      .from('worlds')
      .update({
        world_state: finalWorldState,
        agents: persistedAgentIds,
        updated_at: new Date().toISOString(),
      })
      .eq('id', world.id)
      .select()
      .single();
    if (updateError) throw updateError;

    return NextResponse.json({
      world: {
        id: updatedWorld.id,
        name: updatedWorld.name,
        contractAddress: updatedWorld.contract_address,
        template: templateRecord?.name ?? templateId ?? 'Custom',
        templateSlug: finalWorldState.templateSlug,
        status: updatedWorld.status,
        balance: `${updatedWorld.sttt_balance} STT`,
        activeAgents: persistedAgentIds.length,
        createdAt: updatedWorld.created_at,
        worldState: updatedWorld.world_state,
      },
      createdAgents: [...materialized.createdAgents, ...assignedExistingAgents],
    }, { status: 201 });
  } catch (err) {
    if (err instanceof AgentAssignmentError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('POST /api/apps error:', err);
    return NextResponse.json({ error: 'Failed to save world' }, { status: 500 });
  }
}
