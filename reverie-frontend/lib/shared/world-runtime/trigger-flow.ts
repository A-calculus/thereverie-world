import type {
  AgentExecutionRecord,
  TriggerSourceConfig,
  TriggerTypeConfig,
  WorldBuilderAgentStep,
  WorldBuilderConfig,
  WorldBuilderTrigger,
  WorldRuntimeEvent,
  WorldRuntimeRun,
} from '@/lib/shared/types';
import { resolveBuilderForManifestCore } from '@/lib/shared/live-builder-resolution-core';

type TriggerLike = WorldBuilderTrigger & {
  conditionLabel?: string;
  inputParser?: string;
  executionLane?: string;
  cooldownMs?: number;
  graphPosition?: { x: number; y: number };
};

interface TriggerFlowContext {
  worldId: string;
  builder: WorldBuilderConfig;
  trigger: TriggerLike;
  actionId: string;
  inputs: Record<string, unknown>;
  worldState?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  baseUrl?: string | URL;
}

function now() {
  return new Date().toISOString();
}

function readPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)];
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

function writePath(target: Record<string, unknown>, path: string | undefined, value: unknown) {
  if (!path) return;
  const parts = path.split('.').filter(Boolean);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last) cursor[last] = value;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function interpolatePlain(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => stringifyTemplateValue(readPath(variables, rawPath.trim())));
}

export function isValidCronExpression(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const aliases = [
    {},
    {},
    {},
    { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },
    { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 },
  ] as Array<Record<string, number>>;
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const;
  return parts.every((field, index) => {
    const normalized = field.toLowerCase().replace(/[a-z]{3}/g, (match) => aliases[index]?.[match]?.toString() ?? match);
    return normalized.split(',').every((part) => {
      if (!/^(?:\*|\d{1,2}|\d{1,2}-\d{1,2})(?:\/\d{1,2})?$/.test(part)) return false;
      const numbers = part.match(/\d{1,2}/g)?.map(Number) ?? [];
      return numbers.every((number) => number >= ranges[index][0] && number <= ranges[index][1]);
    });
  });
}

function sourceValue(config: TriggerSourceConfig | undefined, ctx: TriggerFlowContext, variables: Record<string, unknown>): unknown {
  if (!config) return undefined;
  if (config.kind === 'builder_input') return readPath(ctx.inputs, config.sourceId ?? config.path);
  if (config.kind === 'manual_payload') return readPath(ctx.payload ?? {}, config.path);
  if (config.kind === 'runtime_state') return readPath(ctx.worldState ?? {}, config.path);
  if (config.kind === 'schedule_time') return { now: now(), cron: ctx.trigger.typeConfig?.cronExpression };
  if (config.kind === 'zone_state') {
    const zones = Array.isArray(ctx.worldState?.zones) ? ctx.worldState.zones : ctx.builder.zones ?? [];
    const zone = zones.find((item) => item && typeof item === 'object' && (item as { id?: string }).id === config.sourceId);
    return readPath(zone, config.path);
  }
  if (config.kind === 'faction_state') {
    const factions = Array.isArray(ctx.worldState?.factions) ? ctx.worldState.factions : ctx.builder.factions ?? [];
    const faction = factions.find((item) => item && typeof item === 'object' && (item as { id?: string }).id === config.sourceId);
    return readPath(faction, config.path);
  }
  if (config.kind === 'data_source') {
    const raw = readPath(variables.dataSources, config.sourceId);
    return readPath(raw, config.path) ?? readPath(raw, `response${config.path ? `.${config.path}` : ''}`);
  }
  return undefined;
}

function shapeAgentRequest(agent: WorldBuilderAgentStep, variables: Record<string, unknown>, previousInput: unknown, previousOutput: unknown) {
  const prompt = interpolatePlain(agent.inputTemplate || '{{trigger.payload}}', variables);
  const base = {
    prompt,
    context: {
      trigger: variables.trigger,
      runtime: variables.runtime,
      source: variables.source,
      dataSources: variables.dataSources,
      previous: { input: previousInput, output: previousOutput },
    },
  };
  if (agent.agentType === 'native_json_api') return { url: prompt, method: 'GET', ...base };
  if (agent.agentType === 'native_web_parse') return { url: prompt, ...base };
  if (agent.agentType === 'reverie_custom') return { ...base, worldState: variables.worldState };
  return base;
}

function shapeToolInput(tool: WorldBuilderAgentStep, variables: Record<string, unknown>, previousInput: unknown, previousOutput: unknown) {
  const template = tool.toolInputTemplate || '{"input":"{{previous.output}}"}';
  const nextVariables = {
    ...variables,
    previous: tool.consumePreviousOutput === false ? { input: null, output: null } : { input: previousInput, output: previousOutput },
  };
  const mapped = interpolatePlain(template, nextVariables);
  try {
    return JSON.parse(mapped);
  } catch {
    return { input: mapped || null };
  }
}

async function executeToolStep(tool: WorldBuilderAgentStep, input: unknown) {
  if (!tool.toolEndpointUrl) {
    return {
      ok: false,
      output: null,
      error: 'Tool endpoint is not deployed or no endpoint token is available.',
      skipped: true,
    };
  }
  try {
    const response = await fetch(tool.toolEndpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    });
    const body = await response.json().catch(() => ({}));
    return { ...body, ok: response.ok && body.ok !== false };
  } catch (error) {
    return { ok: false, output: null, error: error instanceof Error ? error.message : 'Tool execution failed.' };
  }
}

function responseFor(agent: WorldBuilderAgentStep, request: unknown, previousOutput: unknown, source: unknown) {
  return {
    status: 'local_fallback',
    agentId: agent.agentId ?? agent.id,
    purpose: agent.purpose,
    request,
    previousOutput,
    source,
    note: 'Deterministic trigger runtime recorded this step. Live wallet-signed native execution is handled by the browser agent test flow.',
  };
}

function event(id: string, title: string, description: string): WorldRuntimeEvent {
  return { id, type: 'trigger_fired', title, description, timestamp: now() };
}

export async function executeTriggerFlow(ctx: TriggerFlowContext): Promise<WorldRuntimeRun> {
  const timestamp = now();
  const resolved = await resolveBuilderForManifestCore({
    builder: ctx.builder,
    inputs: ctx.inputs,
    publicState: ctx.worldState,
    fetchDataSources: true,
    resolutionSource: 'local_fallback_trigger',
    baseUrl: ctx.baseUrl,
  });
  const runtimeBuilder = resolved.builder;
  const trigger = runtimeBuilder.triggers?.find((item) => item.id === ctx.trigger.id) ?? ctx.trigger;
  const condition = trigger.condition && typeof trigger.condition === 'object' && !Array.isArray(trigger.condition)
    ? trigger.condition as Record<string, unknown>
    : {};
  const sourceConfig = trigger.sourceConfig ?? condition.sourceConfig as TriggerSourceConfig | undefined;
  const typeConfig = (trigger.typeConfig ?? condition.typeConfig) as TriggerTypeConfig | undefined;
  const inputParser = trigger.inputParser ?? (typeof condition.inputParser === 'string' ? condition.inputParser : '');
  const outputMapping = trigger.outputMapping ?? condition.outputMapping as TriggerLike['outputMapping'] ?? [];
  const nextTriggerIds = trigger.nextTriggerIds ?? (Array.isArray(condition.nextTriggerIds) ? condition.nextTriggerIds.filter((item): item is string => typeof item === 'string') : []);
  const variables: Record<string, unknown> = {
    runtime: { inputs: ctx.inputs, actionId: ctx.actionId },
    trigger: { id: trigger.id, name: trigger.name, type: trigger.type, payload: ctx.payload ?? {} },
    worldState: ctx.worldState ?? {},
    dataSources: resolved.snapshot.dataSources,
    agents: {},
    previous: { input: null, output: null },
  };

  const source = sourceValue(sourceConfig, ctx, variables);
  variables.source = { config: sourceConfig, value: source };

  let parsedPayload: unknown = ctx.payload ?? {};
  if (inputParser) {
    const mapped = interpolatePlain(inputParser, variables);
    try {
      parsedPayload = JSON.parse(mapped);
    } catch {
      parsedPayload = mapped;
    }
    variables.trigger = { ...(variables.trigger as Record<string, unknown>), payload: parsedPayload };
  }

  const chainIds = trigger.agentChain ?? [];
  const chain = chainIds
    .map((agentId) => runtimeBuilder.agentChain.find((agent) => agent.id === agentId || agent.agentId === agentId))
    .filter((agent): agent is WorldBuilderAgentStep => Boolean(agent));
  const agentResponses: AgentExecutionRecord[] = [];
  let previousInput: unknown = null;
  let previousOutput: unknown = null;

  for (const agent of chain) {
    if (agent.stepType === 'tool') {
      const request = shapeToolInput(agent, variables, previousInput, previousOutput);
      const response = await executeToolStep(agent, request);
      const toolKey = agent.toolId ?? agent.id;
      writePath(variables, `tools.${toolKey}.input`, request);
      writePath(variables, `tools.${toolKey}.output`, response);
      variables.previous = {
        input: request,
        output: {
          previousAgent: previousOutput,
          toolResponse: response,
        },
      };
      previousInput = request;
      previousOutput = variables.previous;
      agentResponses.push({
        id: agent.id,
        name: agent.name,
        agentType: 'reverie_custom',
        request,
        response,
        receiptUrl: '',
        status: response.ok ? 'complete' : 'failed',
      });
      continue;
    }
    const request = shapeAgentRequest(agent, variables, previousInput, previousOutput);
    const response = responseFor(agent, request, previousOutput, source);
    const agentKey = agent.agentId ?? agent.id;
    writePath(variables, `agents.${agentKey}.input`, request);
    writePath(variables, `agents.${agentKey}.output`, response);
    variables.previous = { input: request, output: response };
    previousInput = request;
    previousOutput = response;
    agentResponses.push({
      id: typeof (agent as WorldBuilderAgentStep & { sourceStepId?: unknown }).sourceStepId === 'string'
        ? (agent as WorldBuilderAgentStep & { sourceStepId: string }).sourceStepId
        : agent.id,
      name: agent.name,
      agentType: agent.agentType,
      request,
      response,
      receiptUrl: `https://agents.testnet.somnia.network/receipts/trigger-${trigger.id}-${agent.id}-${Date.now()}`,
      status: 'complete',
    });
  }

  const outputState: Record<string, unknown> = {
    lastRunAt: timestamp,
    latestActionId: ctx.actionId,
    latestTriggerId: trigger.id,
    triggerVariables: variables,
    zones: runtimeBuilder.zones ?? [],
    factions: runtimeBuilder.factions ?? [],
  };
  const mappedEvents: WorldRuntimeEvent[] = [];
  for (const mapping of outputMapping) {
    if (mapping.target === 'world_state' && mapping.path) {
      writePath(outputState, mapping.path, mapping.valueTemplate ? interpolatePlain(mapping.valueTemplate, variables) : previousOutput);
    }
    if (mapping.target === 'faction' && mapping.path) {
      const factions = Array.isArray(outputState.factions) ? [...outputState.factions] : [];
      const targetIndex = factions.findIndex((faction) => faction && typeof faction === 'object' && (faction as { id?: string }).id === mapping.targetId);
      if (targetIndex >= 0) {
        const faction = factions[targetIndex] && typeof factions[targetIndex] === 'object'
          ? { ...factions[targetIndex] as Record<string, unknown> }
          : {};
        const state = faction.state && typeof faction.state === 'object' && !Array.isArray(faction.state)
          ? { ...faction.state as Record<string, unknown> }
          : {};
        writePath(state, mapping.path, mapping.valueTemplate ? interpolatePlain(mapping.valueTemplate, variables) : previousOutput);
        faction.state = state;
        factions[targetIndex] = faction;
        outputState.factions = factions;
      } else {
        writePath(outputState, `factionResults.${mapping.targetId ?? 'unassigned'}.${mapping.path}`, mapping.valueTemplate ? interpolatePlain(mapping.valueTemplate, variables) : previousOutput);
      }
    }
    if (mapping.target === 'zone' && mapping.path) {
      const zones = Array.isArray(outputState.zones) ? [...outputState.zones] : [];
      const targetIndex = zones.findIndex((zone) => zone && typeof zone === 'object' && (zone as { id?: string }).id === mapping.targetId);
      if (targetIndex >= 0) {
        const zone = zones[targetIndex] && typeof zones[targetIndex] === 'object'
          ? { ...zones[targetIndex] as Record<string, unknown> }
          : {};
        const state = zone.state && typeof zone.state === 'object' && !Array.isArray(zone.state)
          ? { ...zone.state as Record<string, unknown> }
          : {};
        writePath(state, mapping.path, mapping.valueTemplate ? interpolatePlain(mapping.valueTemplate, variables) : previousOutput);
        zone.state = state;
        zones[targetIndex] = zone;
        outputState.zones = zones;
      } else {
        writePath(outputState, `zoneResults.${mapping.targetId ?? 'unassigned'}.${mapping.path}`, mapping.valueTemplate ? interpolatePlain(mapping.valueTemplate, variables) : previousOutput);
      }
    }
    if (mapping.target === 'event') {
      const value = mapping.valueTemplate ? interpolatePlain(mapping.valueTemplate, variables) : previousOutput;
      mappedEvents.push(event(
        `trigger-event-output-${trigger.id}-${mappedEvents.length}-${Date.now()}`,
        mapping.targetId ?? `${trigger.name} event`,
        stringifyTemplateValue(value),
      ));
    }
  }

  const status = typeConfig?.operator === 'equals' && typeConfig.compareValue === 'STOP_WORLD' ? 'stopped' : 'complete';
  return {
    id: `trigger-${trigger.id}-${Date.now()}`,
    actionId: ctx.actionId,
    engine: runtimeBuilder.engine ?? 'genericEventWorld',
    status,
    inputs: ctx.inputs,
    summary: {
      triggerId: trigger.id,
      triggerName: trigger.name,
      triggerType: trigger.type,
      source,
      conditionPassed: true,
      agentSteps: agentResponses.length,
      nextTriggerIds,
    },
    agentResponses,
    events: [
      event(`trigger-event-${trigger.id}-${Date.now()}`, `${trigger.name} executed`, `Trigger ${trigger.id} executed ${agentResponses.length} chained agent step(s).`),
      ...mappedEvents,
    ],
    receipts: agentResponses.map((agent) => ({ id: agent.id, url: agent.receiptUrl ?? '#', label: agent.name })),
    graph: runtimeBuilder.graph ?? { nodes: [], edges: [] },
    worldState: outputState,
    createdAt: timestamp,
  };
}
