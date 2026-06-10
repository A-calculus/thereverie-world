import type { WorldBuilderConfig, WorldBuilderGraph } from '@/lib/shared/types';

export function slugifyRuntime(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world-runtime';
}

export function buildFoundationGraph(builder: Pick<WorldBuilderConfig, 'inputSchema' | 'dataSources' | 'agentChain' | 'zones' | 'factions' | 'triggers' | 'manualActions'>): WorldBuilderGraph {
  const nodes: WorldBuilderGraph['nodes'] = [];
  const edges: WorldBuilderGraph['edges'] = [];
  let x = 0;

  for (const input of builder.inputSchema ?? []) {
    nodes.push({ id: `input:${input.id}`, type: 'input', label: input.label, refId: input.id, position: { x, y: nodes.length * 80 } });
  }
  x += 240;
  for (const source of builder.dataSources ?? []) {
    nodes.push({ id: `data:${source.id}`, type: 'dataSource', label: source.name, refId: source.id, position: { x, y: nodes.length * 80 } });
  }
  x += 240;
  for (const trigger of builder.triggers ?? []) {
    nodes.push({ id: `trigger:${trigger.id}`, type: 'trigger', label: trigger.name, refId: trigger.id, position: { x, y: nodes.length * 80 } });
    if (trigger.sourceId) edges.push({ id: `edge:${trigger.sourceId}:${trigger.id}`, source: `data:${trigger.sourceId}`, target: `trigger:${trigger.id}`, label: trigger.type, weightPercent: 100 });
    for (const mapping of trigger.outputMapping ?? []) {
      if (mapping.target === 'zone' && mapping.targetId) {
        edges.push({ id: `edge:${trigger.id}:zone:${mapping.targetId}:${mapping.path ?? 'output'}`, source: `trigger:${trigger.id}`, target: `zone:${mapping.targetId}`, label: mapping.path ?? 'output', weightPercent: mapping.weightPercent ?? mapping.priorityPercent ?? 100 });
      }
      if (mapping.target === 'faction' && mapping.targetId) {
        edges.push({ id: `edge:${trigger.id}:faction:${mapping.targetId}:${mapping.path ?? 'output'}`, source: `trigger:${trigger.id}`, target: `faction:${mapping.targetId}`, label: mapping.path ?? 'output', weightPercent: mapping.weightPercent ?? mapping.priorityPercent ?? 100 });
      }
      if (mapping.target === 'world_state') {
        const worldStateNodeId = `world_state:${mapping.path ?? 'state'}`;
        if (!nodes.some((node) => node.id === worldStateNodeId)) {
          nodes.push({ id: worldStateNodeId, type: 'event', label: mapping.path ?? 'World state', refId: mapping.path ?? 'world', position: { x: x + 480, y: nodes.length * 80 } });
        }
        edges.push({ id: `edge:${trigger.id}:world:${mapping.path ?? 'state'}`, source: `trigger:${trigger.id}`, target: worldStateNodeId, label: mapping.path ?? 'state', weightPercent: mapping.weightPercent ?? mapping.priorityPercent ?? 100 });
      }
      if (mapping.target === 'event') {
        const eventNodeId = `event:${trigger.id}:${mapping.path ?? 'log'}`;
        if (!nodes.some((node) => node.id === eventNodeId)) {
          nodes.push({ id: eventNodeId, type: 'event', label: mapping.targetId ?? mapping.path ?? 'Event log', refId: trigger.id, position: { x: x + 480, y: nodes.length * 80 } });
        }
        edges.push({ id: `edge:${trigger.id}:event:${mapping.path ?? 'log'}`, source: `trigger:${trigger.id}`, target: eventNodeId, label: mapping.path ?? 'event', weightPercent: mapping.weightPercent ?? mapping.priorityPercent ?? 100 });
      }
    }
  }
  x += 240;
  for (const agent of builder.agentChain ?? []) {
    nodes.push({ id: `agent:${agent.id}`, type: 'agent', label: agent.name, refId: agent.id, position: { x, y: nodes.length * 80 } });
  }
  x += 240;
  for (const zone of builder.zones ?? []) {
    nodes.push({ id: `zone:${zone.id}`, type: 'zone', label: zone.name, refId: zone.id, position: { x, y: nodes.length * 80 } });
  }
  for (const faction of builder.factions ?? []) {
    nodes.push({ id: `faction:${faction.id}`, type: 'faction', label: faction.name, refId: faction.id, position: { x: x + 240, y: nodes.length * 80 } });
  }
  for (const action of builder.manualActions ?? []) {
    nodes.push({ id: `action:${action.id}`, type: 'manualAction', label: action.label, refId: action.id, position: { x: 0, y: nodes.length * 80 } });
    if (action.triggerId) edges.push({ id: `edge:${action.id}:${action.triggerId}`, source: `action:${action.id}`, target: `trigger:${action.triggerId}`, label: 'manual', weightPercent: 100 });
  }
  return { nodes, edges };
}

export const foundationRuntimeLayout: WorldBuilderConfig['runtimeLayout'] = [
  { id: 'world-graph', title: 'World Graph', kind: 'graph', source: 'graph' },
  { id: 'latest-state', title: 'Latest State', kind: 'json', source: 'publicState' },
  { id: 'manual-actions', title: 'Manual Actions', kind: 'manual_actions', source: 'manualActions' },
  { id: 'event-log', title: 'Live Events', kind: 'event_log', source: 'events' },
  { id: 'agent-responses', title: 'Agent Responses', kind: 'agent_response', source: 'agentResponses' },
  { id: 'receipts', title: 'Receipts', kind: 'receipt_list', source: 'receipts' },
];

export const foundationStatusPolicy: WorldBuilderConfig['statusPolicy'] = {
  runningStatus: 'running',
  stoppedStatus: 'stopped',
  restartRequiresFreshInputs: true,
};

export function createRuntimeFoundationConfig(params: {
  name: string;
  slug?: string;
  description?: string;
  includeStarterScaffold?: boolean;
}): WorldBuilderConfig {
  const uiSlug = slugifyRuntime(params.slug ?? params.name);
  const includeStarter = Boolean(params.includeStarterScaffold);
  const builder: WorldBuilderConfig = {
    uiSlug,
    displayName: params.name,
    description: params.description ?? `Runtime interface for ${params.name}.`,
    version: 'runtime-foundation-v1',
    engine: 'genericEventWorld',
    publicTypes: {
      RuntimeDecision: ['CONTINUE', 'REVIEW', 'STOP_WORLD'],
      inputs: includeStarter ? ['runtimeInput'] : [],
    },
    inputSchema: includeStarter
      ? [{ id: 'runtimeInput', label: 'Runtime input', type: 'json', required: false, defaultValue: '{}' }]
      : [],
    dataSources: [],
    agentChain: [],
    zones: includeStarter
      ? [{
          id: 'zone-1',
          name: 'Zone 1',
          description: 'Editable placeholder zone for the world.',
          allocationPercent: 100,
          state: {
            latestDecision: 'pending',
            dangerLevel: 0,
            controllingFaction: 'faction-1',
            climate: 'CALM',
          },
        }]
      : [],
    factions: includeStarter
      ? [{
          id: 'faction-1',
          name: 'Faction 1',
          description: 'Editable placeholder faction that can write world state.',
          allocationPercent: 100,
          state: {
            latestDecision: 'pending',
            morale: 50,
            narrative: 'Faction 1 is initialized from the blank world manifest.',
          },
        }]
      : [],
    triggers: includeStarter
      ? [{
          id: 'manual-runtime-action',
          name: 'Manual Runtime Action',
          type: 'manual_action',
          condition: {},
          sourceConfig: { kind: 'manual_payload', path: '' },
          typeConfig: {
            buttonLabel: 'Run Manual Action',
            description: 'Editable starter trigger. Attach agents before using it as a real workflow.',
            payloadTemplate: '{\n  "input": "{{runtime.inputs.runtimeInput}}"\n}',
          },
          inputParser: '{\n  "input": "{{runtime.inputs.runtimeInput}}",\n  "payload": "{{trigger.payload}}"\n}',
          outputMapping: [
            { target: 'event', targetId: 'Runtime event log', path: 'eventLog', valueTemplate: '{{trigger.name}} completed and wrote an event log.', weightPercent: 10 },
            { target: 'zone', targetId: 'zone-1', path: 'latestDecision', valueTemplate: '{{trigger.name}} updated the starter zone.', weightPercent: 30 },
            { target: 'faction', targetId: 'faction-1', path: 'latestDecision', valueTemplate: '{{trigger.name}} updated the starter faction.', weightPercent: 30 },
            { target: 'world_state', path: 'latestWorldResult', valueTemplate: '{{trigger.name}} completed and refreshed the world summary.', weightPercent: 30 },
          ],
          agentChain: [],
          isActive: false,
        }]
      : [],
    manualActions: includeStarter
      ? [{ id: 'run-manual-runtime-action', label: 'Run Manual Action', description: 'Editable starter manual action.', triggerId: 'manual-runtime-action', ownerOnly: true }]
      : [],
    graph: { nodes: [], edges: [] },
    runtimeLayout: foundationRuntimeLayout,
    statusPolicy: foundationStatusPolicy,
    secrets: [],
    lastPublishedAt: null,
    config: {
      worldSlug: uiSlug,
      runtimeFoundation: 'runtime-foundation-v1',
      starterScaffold: includeStarter,
    },
  };
  return {
    ...builder,
    graph: buildFoundationGraph(builder),
  };
}

export function createBlankWorldBuilderConfig(params: {
  name: string;
  slug?: string;
  description?: string;
}): WorldBuilderConfig {
  return createRuntimeFoundationConfig({ ...params, includeStarterScaffold: true });
}

function dedupeAgentChain(chain: WorldBuilderConfig['agentChain'] = []): WorldBuilderConfig['agentChain'] {
  const seen = new Set<string>();
  return chain.filter((step) => {
    const key = step.agentId ?? step.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeWithRuntimeFoundation(builder: WorldBuilderConfig): WorldBuilderConfig {
  const foundation = createRuntimeFoundationConfig({
    name: builder.displayName || 'World Runtime',
    slug: builder.uiSlug,
    description: builder.description,
    includeStarterScaffold: false,
  });
  const normalized: WorldBuilderConfig = {
    ...foundation,
    ...builder,
    engine: builder.engine ?? 'genericEventWorld',
    publicTypes: builder.publicTypes ?? foundation.publicTypes,
    inputSchema: builder.inputSchema ?? [],
    dataSources: builder.dataSources ?? [],
    agentChain: dedupeAgentChain(builder.agentChain ?? []),
    zones: builder.zones ?? [],
    factions: builder.factions ?? [],
    triggers: builder.triggers ?? [],
    manualActions: builder.manualActions ?? [],
    runtimeLayout: builder.runtimeLayout && builder.runtimeLayout.length > 0 ? builder.runtimeLayout : foundationRuntimeLayout,
    statusPolicy: builder.statusPolicy ?? foundationStatusPolicy,
    secrets: builder.secrets ?? [],
    config: {
      ...(foundation.config ?? {}),
      ...(builder.config ?? {}),
      runtimeFoundation: 'runtime-foundation-v1',
    },
  };
  return {
    ...normalized,
    graph: normalized.graph && normalized.graph.nodes.length > 0 ? normalized.graph : buildFoundationGraph(normalized),
  };
}
