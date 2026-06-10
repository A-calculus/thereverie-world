'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { Edge, EdgeChange, Node, NodeChange } from '@xyflow/react';
import { ArrowLeft, Bot, GitBranch, Plus, Save, Trash2, Zap } from 'lucide-react';
import { cacheServerWorld, removeCachedWorld } from '@/lib/client/query-cache';
import { useAgents } from '@/lib/hooks/useAgents';
import { getAssignedWorld } from '@/lib/shared/agent-identity';
import { worldUrl } from '@/lib/shared/routes';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import { isValidCronExpression } from '@/lib/shared/world-runtime/trigger-flow';
import {
  buildContractEventPayload,
  contractEventDataPointOptions,
  contractEventTopic0,
  customContractEventChoices,
  getKnownWorldEvent,
  knownWorldEvents,
  normalizeContractEventDataPoints,
  sanitizePayloadAlias,
} from '@/lib/shared/contract-events';
import type {
  AgentSummary,
  ContractEventConfig,
  ContractEventDataPoint,
  ContractEventMode,
  ExecutionLane,
  FeedType,
  TriggerOutputMapping,
  TriggerSourceConfig,
  TriggerSummary,
  TriggerType,
  TriggerTypeConfig,
  WorldBuilderAgentStep,
  WorldBuilderConfig,
  WorldBuilderTrigger,
  WorldSummary,
} from '@/lib/shared/types';

type TriggerDraft = TriggerSummary & { isDraft?: boolean };
type MessageTone = 'neutral' | 'success' | 'error';

type WorldResponse = {
  id?: string;
  name?: string;
  contractAddress?: string;
  worldState?: {
    agents?: string[];
    builder?: WorldBuilderConfig;
    zones?: Array<{ id?: string; name?: string }>;
    factions?: Array<{ id?: string; name?: string }>;
  };
};

type SourceOption = {
  label: string;
  value: string;
  config: TriggerSourceConfig;
};

type PathOption = {
  label: string;
  value: string;
};

const triggerTypes: TriggerType[] = ['manual_action', 'scheduled', 'data_condition', 'contract_event'];
const executionLanes: ExecutionLane[] = ['sdk', 'onchain'];
const operators: NonNullable<TriggerTypeConfig['operator']>[] = ['exists', 'equals', 'not_equals', 'contains', 'greater_than', 'less_than'];
const contractModes: ContractEventMode[] = ['world_abi', 'custom_abi', 'raw_topics'];

function agentName(agent: AgentSummary) {
  return agent.isOfficial ? `${agent.name} (official)` : agent.name;
}

function sourceKey(config?: TriggerSourceConfig) {
  if (!config?.kind) return '';
  return `${config.kind}:${config.sourceId ?? ''}`;
}

function compactSourceLabel(config?: TriggerSourceConfig) {
  if (!config?.kind) return 'No source';
  return [config.kind, config.sourceId, config.path].filter(Boolean).join(' / ');
}

function nodeClass(kind: 'trigger' | 'source' | 'agent' | 'output', selected = false, isStart = false) {
  const base = 'border-2 rounded-lg p-3 shadow-lg w-[180px] min-h-[92px] whitespace-pre-line font-semibold text-sm flex items-center justify-center text-center';
  if (selected) return `${base} border-teal bg-[#E7FFF8] text-[#041F1A]`;
  if (kind === 'trigger' && isStart) return `${base} border-aurora bg-[#FFF4FF] text-[#241127]`;
  if (kind === 'source') return `${base} border-[#66E9D3] bg-[#E9FFFB] text-[#04231F]`;
  if (kind === 'agent') return `${base} border-[#9B7FE8] bg-[#F3F0FF] text-[#161225]`;
  if (kind === 'output') return `${base} border-[#F3B6FF] bg-[#FFF4FF] text-[#241127]`;
  return `${base} border-dream bg-[#F3F0FF] text-[#161225]`;
}

function distributePercent(count: number) {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_item, index) => base + (index < remainder ? 1 : 0));
}

function normalizeOutputAllocations(items: TriggerOutputMapping[]) {
  const allocations = distributePercent(items.length);
  return items.map((item, index) => ({
    ...item,
    weightPercent: allocations[index] ?? 0,
    priorityPercent: undefined,
  }));
}

function triggerLabel(trigger: TriggerDraft) {
  return `${trigger.name}${trigger.isDraft ? ' (draft)' : ''}\n${trigger.triggerType ?? 'data_condition'}${trigger.isStartTrigger ? '\nSTART' : ''}`;
}

function defaultTypeConfig(type: TriggerType): TriggerTypeConfig {
  if (type === 'manual_action') return { buttonLabel: 'Run Trigger', description: '', payloadTemplate: '{\n  "payload": "{{runtime.inputs}}"\n}' };
  if (type === 'scheduled') return { cronExpression: '* * * * *', timezone: 'UTC' };
  if (type === 'data_condition') return { conditionEnabled: true, operator: 'exists', compareValue: '' };
  const known = getKnownWorldEvent('AgentDecisionReceived');
  return {
    contractEventName: known.name,
    contractEvent: {
      mode: 'world_abi',
      eventName: known.name,
      eventSignature: known.signature,
      topic0: known.topic0,
      gasLimit: 500_000,
      dataPoints: normalizeContractEventDataPoints({
        mode: 'world_abi',
        eventName: known.name,
        eventSignature: known.signature,
        topic0: known.topic0,
      }),
    },
  };
}

function defaultSourceConfig(type: TriggerType): TriggerSourceConfig {
  if (type === 'manual_action') return { kind: 'manual_payload', includeInAgentInput: true };
  if (type === 'scheduled') return { kind: 'schedule_time', path: 'now', includeInAgentInput: true };
  if (type === 'contract_event') return { kind: 'manual_payload', includeInAgentInput: true };
  return { kind: 'runtime_state', path: 'latestRun', includeInAgentInput: true };
}

function defaultPathForSource(config: TriggerSourceConfig): string | undefined {
  if (config.kind === 'faction_state') return 'morale';
  if (config.kind === 'zone_state') return 'name';
  if (config.kind === 'schedule_time') return 'now';
  if (config.kind === 'builder_input') return undefined;
  if (config.kind === 'manual_payload') return undefined;
  if (config.kind === 'runtime_state') return config.path ?? 'latestRun';
  return config.path;
}

function createDraftTrigger(index: number, isFirst: boolean): TriggerDraft {
  const type: TriggerType = isFirst ? 'manual_action' : 'data_condition';
  const id = `draft-${Date.now()}-${index}`;
  return {
    id,
    worldId: '',
    name: isFirst ? 'Starting Trigger' : `Trigger ${index}`,
    feedType: 'time',
    triggerType: type,
    conditionLabel: isFirst ? 'Owner starts the world' : 'IF source condition is true',
    agentName: 'Agent Chain',
    executionLane: 'sdk',
    cooldownMs: 0,
    isActive: true,
    graphNodeId: `trigger:${id}`,
    chain: [],
    inputParser: '{\n  "payload": "{{runtime.inputs}}",\n  "source": "{{source.value}}"\n}',
    isStartTrigger: isFirst,
    sourceConfig: defaultSourceConfig(type),
    typeConfig: defaultTypeConfig(type),
    outputMapping: [{ target: 'faction', path: 'latestDecision', valueTemplate: '{{previous.output}}' }],
    isDraft: true,
  };
}

function draftFromBuilderTrigger(trigger: WorldBuilderTrigger, worldId: string): TriggerDraft {
  const condition = trigger.condition ?? {};
  return {
    id: trigger.id,
    worldId,
    name: trigger.name,
    feedType: feedTypeForSource(trigger.sourceConfig),
    triggerType: trigger.type,
    conditionLabel: trigger.conditionLabel ?? (typeof condition.label === 'string' ? condition.label : 'IF condition is true'),
    agentName: trigger.agentChain?.length ? `${trigger.agentChain.length} chained agents` : 'Agent Chain',
    executionLane: trigger.executionLane ?? (condition.executionLane as ExecutionLane | undefined) ?? 'sdk',
    cooldownMs: trigger.cooldownMs ?? Number(condition.cooldownMs ?? 0),
    isActive: trigger.isActive,
    graphNodeId: typeof condition.graphNodeId === 'string' ? condition.graphNodeId : `trigger:${trigger.id}`,
    chain: trigger.agentChain ?? [],
    inputParser: trigger.inputParser ?? (typeof condition.inputParser === 'string' ? condition.inputParser : ''),
    isStartTrigger: Boolean(condition.isStartTrigger),
    graphPosition: trigger.graphPosition,
    sourceConfig: trigger.sourceConfig ?? condition.sourceConfig as TriggerSourceConfig | undefined,
    typeConfig: trigger.typeConfig ?? condition.typeConfig as TriggerTypeConfig | undefined,
    outputMapping: trigger.outputMapping ?? condition.outputMapping as TriggerOutputMapping[] | undefined,
    nextTriggerIds: trigger.nextTriggerIds,
    isDraft: true,
  };
}

function feedTypeForSource(config?: TriggerSourceConfig): FeedType {
  if (config?.kind === 'schedule_time') return 'time';
  if (config?.kind === 'data_source') return 'web_scrape';
  return 'time';
}

function isResultStateKey(value: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(value);
}

function isHexAddress(value: string | undefined): boolean {
  return Boolean(value && /^0x[0-9a-fA-F]{40}$/.test(value));
}

function validateContractEventConfig(config: ContractEventConfig | undefined) {
  if (!config) return 'Contract event triggers require an event configuration.';
  if (!isHexAddress(config.emitterAddress)) return 'Contract event emitter address must be a valid 0x address.';
  if (config.mode === 'raw_topics' && !config.topic0) return 'Raw topic mode requires topic0.';
  if (config.mode !== 'raw_topics' && !contractEventTopic0(config)) return 'Contract event mode requires a valid known or custom event signature.';
  if (!normalizeContractEventDataPoints(config).some((point) => point.include)) return 'Select at least one datapoint for the contract event payload.';
  return null;
}

export default function TriggersPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const worldId = params.worldId as string;
  const hostWorldSlug = useWorldSlugFromHost();
  const [querySelectedTriggerId] = useState(() => (
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('triggerId') : null
  ));
  const { data: agents = [] } = useAgents();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [triggers, setTriggers] = useState<TriggerDraft[]>([]);
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(querySelectedTriggerId);
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [message, setMessage] = useState('Loading triggers...');
  const [messageTone, setMessageTone] = useState<MessageTone>('neutral');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deletingTrigger, setDeletingTrigger] = useState(false);
  const [agentToAdd, setAgentToAdd] = useState('');

  const selectedTrigger = useMemo(
    () => triggers.find((trigger) => trigger.id === selectedTriggerId) ?? null,
    [selectedTriggerId, triggers],
  );
  const builder = world?.worldState?.builder;
  const worldSlug = hostWorldSlug;
  const worldHref = worldUrl({ id: worldId, name: world?.name, slug: worldSlug });
  const worldContractAddress = world?.contractAddress ?? '';

  const withContractDefaults = useCallback((config?: ContractEventConfig): ContractEventConfig => {
    const base = config ?? defaultTypeConfig('contract_event').contractEvent;
    const mode = base?.mode ?? 'world_abi';
    const known = getKnownWorldEvent(base?.eventName ?? base?.eventSignature ?? 'AgentDecisionReceived');
    const next: ContractEventConfig = {
      mode,
      emitterAddress: base?.emitterAddress || worldContractAddress,
      eventName: base?.eventName ?? (mode === 'world_abi' ? known.name : ''),
      eventSignature: base?.eventSignature ?? (mode === 'world_abi' ? known.signature : ''),
      abiJson: base?.abiJson ?? '',
      topic0: base?.topic0 ?? (mode === 'world_abi' ? known.topic0 : ''),
      topic1: base?.topic1 ?? '',
      topic2: base?.topic2 ?? '',
      topic3: base?.topic3 ?? '',
      gasLimit: base?.gasLimit ?? 500_000,
      subscription: base?.subscription,
    };
    return {
      ...next,
      topic0: contractEventTopic0(next) ?? next.topic0,
      dataPoints: normalizeContractEventDataPoints({ ...next, dataPoints: base?.dataPoints }),
    };
  }, [worldContractAddress]);

  const attachedAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of world?.worldState?.agents ?? []) ids.add(id);
    for (const step of builder?.agentChain ?? []) ids.add(step.agentId ?? step.id);
    return ids;
  }, [builder?.agentChain, world?.worldState?.agents]);

  const availableAgents = useMemo(() => (
    agents.filter((agent) => {
      if (agent.status !== 'ACTIVE') return false;
      if (attachedAgentIds.has(agent.id)) return true;
      const assigned = getAssignedWorld(agent);
      return assigned.id === worldId || Boolean(world?.id && assigned.id === world.id);
    })
  ), [agents, attachedAgentIds, world, worldId]);

  const availableToolSteps = useMemo<WorldBuilderAgentStep[]>(() => (
    (builder?.agentChain ?? []).filter((step) => step.stepType === 'tool' && step.toolId)
  ), [builder?.agentChain]);
  const selectedChainSteps = useMemo(() => (
    (selectedTrigger?.chain ?? []).map((stepId) => {
      const tool = availableToolSteps.find((step) => step.id === stepId || step.toolId === stepId);
      if (tool) return { id: stepId, label: `Tool: ${tool.name}`, kind: 'tool' as const };
      const agent = availableAgents.find((item) => item.id === stepId) ?? agents.find((item) => item.id === stepId);
      if (agent) return { id: stepId, label: agentName(agent), kind: 'agent' as const };
      return { id: stepId, label: stepId, kind: 'unknown' as const };
    })
  ), [agents, availableAgents, availableToolSteps, selectedTrigger?.chain]);

  const sourceOptions = useMemo<SourceOption[]>(() => {
    const options: SourceOption[] = [
      { label: 'Manual payload', value: 'manual_payload::', config: { kind: 'manual_payload', includeInAgentInput: true } },
      { label: 'Schedule time', value: 'schedule_time::', config: { kind: 'schedule_time', includeInAgentInput: true } },
      { label: 'Runtime state', value: 'runtime_state::latestRun', config: { kind: 'runtime_state', path: 'latestRun', includeInAgentInput: true } },
    ];
    for (const input of builder?.inputSchema ?? []) {
      options.push({ label: `Input: ${input.label}`, value: sourceKey({ kind: 'builder_input', sourceId: input.id }), config: { kind: 'builder_input', sourceId: input.id, includeInAgentInput: true } });
    }
    for (const source of builder?.dataSources ?? []) {
      options.push({ label: `Data source: ${source.name}`, value: sourceKey({ kind: 'data_source', sourceId: source.id }), config: { kind: 'data_source', sourceId: source.id, includeInAgentInput: true } });
    }
    for (const zone of builder?.zones ?? world?.worldState?.zones ?? []) {
      if (zone.id) options.push({ label: `Zone: ${zone.name ?? zone.id}`, value: sourceKey({ kind: 'zone_state', sourceId: zone.id }), config: { kind: 'zone_state', sourceId: zone.id, includeInAgentInput: true } });
    }
    for (const faction of builder?.factions ?? world?.worldState?.factions ?? []) {
      if (faction.id) options.push({ label: `Faction: ${faction.name ?? faction.id}`, value: sourceKey({ kind: 'faction_state', sourceId: faction.id }), config: { kind: 'faction_state', sourceId: faction.id, includeInAgentInput: true } });
    }
    return options;
  }, [builder, world?.worldState?.factions, world?.worldState?.zones]);

  const filteredSourceOptions = useMemo(() => {
    const type = selectedTrigger?.triggerType ?? 'data_condition';
    if (type === 'scheduled') return sourceOptions.filter((option) => option.config.kind === 'schedule_time');
    if (type === 'contract_event') return [];
    if (type === 'data_condition') return sourceOptions.filter((option) => option.config.kind !== 'manual_payload' && option.config.kind !== 'schedule_time');
    return sourceOptions;
  }, [selectedTrigger?.triggerType, sourceOptions]);

  const sourcePathOptions = useMemo<PathOption[]>(() => {
    const kind = selectedTrigger?.sourceConfig?.kind;
    if (kind === 'faction_state') {
      return [
        { label: 'Name', value: 'name' },
        { label: 'Morale', value: 'morale' },
        { label: 'Latest decision', value: 'state.latestDecision' },
        { label: 'Final decision', value: 'state.finalDecision' },
      ];
    }
    if (kind === 'zone_state') {
      return [
        { label: 'Name', value: 'name' },
        { label: 'Description', value: 'description' },
        { label: 'Latest decision', value: 'state.latestDecision' },
      ];
    }
    if (kind === 'schedule_time') {
      return [
        { label: 'Current timestamp', value: 'now' },
        { label: 'Cron expression', value: 'cron' },
      ];
    }
    if (kind === 'builder_input') {
      return [{ label: 'Input value', value: '' }];
    }
    return [];
  }, [selectedTrigger?.sourceConfig?.kind]);

  const factionTargets = useMemo(() => (
    (builder?.factions ?? world?.worldState?.factions ?? []).filter((faction) => faction.id)
  ), [builder?.factions, world?.worldState?.factions]);
  const zoneTargets = useMemo(() => (
    (builder?.zones ?? world?.worldState?.zones ?? []).filter((zone) => zone.id)
  ), [builder?.zones, world?.worldState?.zones]);

  const rebuildGraph = useCallback((nextTriggers: TriggerDraft[], currentSelectedId: string | null) => {
    const nextNodes: Node[] = [];
    const nextEdges: Edge[] = [];
    const visibleTriggers = currentSelectedId
      ? nextTriggers.filter((trigger) => trigger.id === currentSelectedId)
      : nextTriggers;
    visibleTriggers.forEach((trigger, triggerIndex) => {
      const x = 80 + triggerIndex * 260;
      const triggerNodeId = `${trigger.id}:trigger`;
      const sourceNodeId = `${trigger.id}:source`;
      const outputNodeId = `${trigger.id}:output`;
      nextNodes.push({
        id: triggerNodeId,
        type: trigger.isStartTrigger ? 'input' : 'default',
        position: trigger.graphPosition ?? { x, y: 80 },
        data: { label: triggerLabel(trigger), triggerId: trigger.id },
        className: nodeClass('trigger', currentSelectedId === trigger.id, Boolean(trigger.isStartTrigger)),
      });
      nextNodes.push({
        id: sourceNodeId,
        position: { x, y: 220 },
        data: { label: `Source\n${compactSourceLabel(trigger.sourceConfig)}`, triggerId: trigger.id },
        className: nodeClass('source'),
      });
      nextEdges.push({ id: `${trigger.id}:trigger-source`, source: triggerNodeId, target: sourceNodeId, animated: true, label: 'source', style: { stroke: '#66E9D3', strokeWidth: 2 } });
      let previous = sourceNodeId;
      const chain = trigger.chain ?? [];
      chain.forEach((agentId, agentIndex) => {
        const agent = agents.find((item) => item.id === agentId);
        const agentNodeId = `${trigger.id}:agent:${agentId}`;
        nextNodes.push({
          id: agentNodeId,
          position: { x, y: 360 + agentIndex * 140 },
          data: { label: `Agent ${agentIndex + 1}\n${agent?.name ?? agentId}`, triggerId: trigger.id },
          className: nodeClass('agent'),
        });
        nextEdges.push({ id: `${trigger.id}:edge:${previous}:${agentNodeId}`, source: previous, target: agentNodeId, animated: true, label: agentIndex === 0 ? 'input' : 'previous output', style: { stroke: '#9B7FE8', strokeWidth: 2 } });
        previous = agentNodeId;
      });
      nextNodes.push({
        id: outputNodeId,
        position: { x, y: 360 + Math.max(chain.length, 1) * 140 },
        data: { label: `Output\n${trigger.outputMapping?.[0]?.path ?? 'latestDecision'}`, triggerId: trigger.id },
        className: nodeClass('output'),
      });
      nextEdges.push({ id: `${trigger.id}:edge:${previous}:${outputNodeId}`, source: previous, target: outputNodeId, animated: true, label: 'updates', style: { stroke: '#F3B6FF', strokeWidth: 2 } });
    });
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [agents]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [triggerResponse, worldResponse] = await Promise.all([
        fetch(`/api/triggers?worldId=${worldId}`).then((res) => res.json()).catch(() => ({ triggers: [] })),
        fetch(`/api/apps/${worldId}`).then((res) => res.json()).catch(() => null),
      ]);
      if (cancelled) return;
      if (worldResponse?.error === 'World not found') {
        removeCachedWorld(worldId);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => current.filter((item) => item.id !== worldId));
        setMessage('World not found.');
        setMessageTone('error');
      }
      const persistedTriggers: TriggerDraft[] = (triggerResponse.triggers ?? []).map((trigger: TriggerSummary) => ({ ...trigger, isDraft: false }));
      const builderTriggers = worldResponse?.worldState?.builder?.triggers ?? [];
      const nextTriggers: TriggerDraft[] = persistedTriggers.length > 0
        ? persistedTriggers
        : builderTriggers.map((trigger: WorldBuilderTrigger) => draftFromBuilderTrigger(trigger, worldId));
      const nextSelected = querySelectedTriggerId && nextTriggers.some((trigger) => trigger.id === querySelectedTriggerId)
        ? querySelectedTriggerId
        : null;
      setWorld(worldResponse);
      setTriggers(nextTriggers);
      setSelectedTriggerId(nextSelected);
      rebuildGraph(nextTriggers, nextSelected);
      if (worldResponse?.error !== 'World not found') {
        setMessage(nextTriggers.length > 0
          ? persistedTriggers.length > 0
            ? 'Triggers loaded.'
            : 'Template trigger drafts loaded from the copied builder config. Save or deploy to persist them for this world.'
          : 'No triggers yet. Create a starting trigger.');
        setMessageTone('neutral');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [queryClient, querySelectedTriggerId, rebuildGraph, worldId]);

  useEffect(() => {
    void Promise.resolve().then(() => rebuildGraph(triggers, selectedTriggerId));
  }, [rebuildGraph, selectedTriggerId, triggers]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );

  const selectTrigger = (triggerId: string) => {
    setSelectedTriggerId(triggerId);
    router.replace(`${worldUrl({ id: worldId, name: world?.name, slug: worldSlug }, '/triggers')}?triggerId=${triggerId}`, { scroll: false });
  };

  const showTriggerList = () => {
    setSelectedTriggerId(null);
    router.replace(worldUrl({ id: worldId, name: world?.name, slug: worldSlug }, '/triggers'), { scroll: false });
  };

  const patchSelectedTrigger = (patch: Partial<TriggerDraft>) => {
    if (!selectedTrigger) return;
    const patched = { ...selectedTrigger, ...patch };
    if (patch.isStartTrigger) {
      setTriggers((current) => current.map((trigger) => (
        trigger.id === selectedTrigger.id ? patched : { ...trigger, isStartTrigger: false }
      )));
    } else {
      setTriggers((current) => current.map((trigger) => trigger.id === selectedTrigger.id ? patched : trigger));
    }
  };

  const updateTriggerType = (type: TriggerType) => {
    const typeConfig = defaultTypeConfig(type);
    if (type === 'contract_event') {
      typeConfig.contractEvent = withContractDefaults(typeConfig.contractEvent);
      typeConfig.contractEventName = typeConfig.contractEvent.eventName;
    }
    patchSelectedTrigger({
      triggerType: type,
      sourceConfig: defaultSourceConfig(type),
      typeConfig,
      feedType: feedTypeForSource(defaultSourceConfig(type)),
    });
  };

  const addTrigger = () => {
    const isFirstTrigger = triggers.length === 0;
    const draft = createDraftTrigger(triggers.length + 1, isFirstTrigger);
    const nextTriggers = isFirstTrigger ? [draft] : [draft, ...triggers];
    setTriggers(nextTriggers);
    setSelectedTriggerId(draft.id);
    router.replace(`${worldUrl({ id: worldId, name: world?.name, slug: worldSlug }, '/triggers')}?triggerId=${draft.id}`, { scroll: false });
    setMessage('Draft trigger created. Save it to persist.');
    setMessageTone('success');
  };

  const triggerPayload = (trigger: TriggerDraft, position?: { x: number; y: number }) => ({
    worldId,
    name: trigger.name,
    feedType: feedTypeForSource(trigger.sourceConfig) ?? trigger.feedType,
    triggerType: trigger.triggerType ?? 'data_condition',
    conditionLabel: trigger.conditionLabel,
    agentName: trigger.chain?.length ? `${trigger.chain.length} chained agents` : trigger.agentName,
    executionLane: trigger.executionLane,
    cooldownMs: trigger.cooldownMs,
    isActive: trigger.isActive,
    graphNodeId: trigger.graphNodeId ?? `trigger:${trigger.id}`,
    chain: trigger.chain ?? [],
    inputParser: trigger.inputParser ?? '',
    isStartTrigger: Boolean(trigger.isStartTrigger),
    sourceConfig: trigger.sourceConfig ?? defaultSourceConfig(trigger.triggerType ?? 'data_condition'),
    typeConfig: trigger.triggerType === 'contract_event'
      ? {
          ...(trigger.typeConfig ?? {}),
          contractEvent: withContractDefaults(trigger.typeConfig?.contractEvent),
          contractEventName: withContractDefaults(trigger.typeConfig?.contractEvent).eventName,
        }
      : trigger.typeConfig ?? defaultTypeConfig(trigger.triggerType ?? 'data_condition'),
    outputMapping: (trigger.outputMapping && trigger.outputMapping.length > 0)
      ? normalizeOutputAllocations(trigger.outputMapping.map((mapping) => ({
          ...mapping,
          targetId: mapping.target === 'faction'
            ? mapping.targetId || factionTargets[0]?.id
            : mapping.target === 'zone'
              ? mapping.targetId || zoneTargets[0]?.id
              : mapping.target === 'world_state'
                ? 'world'
                : mapping.targetId || 'event',
          path: mapping.path || (mapping.target === 'event' ? 'description' : 'latestDecision'),
          valueTemplate: mapping.valueTemplate || '{{previous.output}}',
        })))
      : normalizeOutputAllocations([{ target: 'faction' as const, targetId: factionTargets[0]?.id, path: 'latestDecision', valueTemplate: '{{previous.output}}' }]),
    condition: {
      graphPosition: position ?? trigger.graphPosition,
      graphEdges: edges
        .filter((edge) => edge.source.startsWith(`${trigger.id}:`) || edge.target.startsWith(`${trigger.id}:`))
        .map((edge) => ({ source: edge.source, target: edge.target })),
    },
  });

  const validateResultMappings = (items: TriggerDraft[]) => {
    const invalid = items.find((trigger) => (
      (trigger.outputMapping ?? []).some((mapping) => mapping.target !== 'event' && mapping.path && !isResultStateKey(mapping.path))
    ));
    if (!invalid) return null;
    return `Trigger "${invalid.name}" has an invalid output state key. Use lowercase or camelCase only, for example latestDecision or finalDecision.`;
  };

  const saveTrigger = async (trigger: TriggerDraft) => {
    const triggerNode = nodes.find((item) => item.id === `${trigger.id}:trigger`);
    if (trigger.triggerType === 'scheduled' && trigger.typeConfig?.scheduleMode !== 'current_timestamp' && !isValidCronExpression(trigger.typeConfig?.cronExpression ?? '')) {
      setMessage('Scheduled triggers require a valid 5-field cron expression.');
      setMessageTone('error');
      return undefined;
    }
    if (trigger.triggerType === 'contract_event') {
      const contractError = validateContractEventConfig(withContractDefaults(trigger.typeConfig?.contractEvent));
      if (contractError) {
        setMessage(contractError);
        setMessageTone('error');
        return undefined;
      }
    }
    const resultError = validateResultMappings([trigger]);
    if (resultError) {
      setMessage(resultError);
      setMessageTone('error');
      return undefined;
    }
    const isDraft = trigger.isDraft || trigger.id.startsWith('draft-');
    const response = await fetch(isDraft ? '/api/triggers' : `/api/triggers/${trigger.id}`, {
      method: isDraft ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(triggerPayload(trigger, triggerNode?.position ?? trigger.graphPosition)),
    }).then((res) => res.json()).catch(() => null);
    if (response?.error) {
      setMessage(response.error);
      setMessageTone('error');
    }
    return response?.trigger ? { ...response.trigger, isDraft: false } as TriggerDraft : undefined;
  };

  const saveSelectedTrigger = async () => {
    if (!selectedTrigger) return;
    setIsDeploying(true);
    const saved = await saveTrigger(selectedTrigger);
    if (saved) {
      const nextTriggers = triggers.map((trigger) => trigger.id === selectedTrigger.id ? saved : trigger);
      setTriggers(nextTriggers);
      setSelectedTriggerId(saved.id);
      router.replace(`${worldUrl({ id: worldId, name: world?.name, slug: worldSlug }, '/triggers')}?triggerId=${saved.id}`, { scroll: false });
      setMessage('Trigger saved.');
      setMessageTone('success');
    } else {
      setMessage('Unable to save trigger.');
      setMessageTone('error');
    }
    setIsDeploying(false);
  };

  const validateDeploy = (items: TriggerDraft[]) => {
    const startCount = items.filter((trigger) => trigger.isStartTrigger).length;
    if (startCount !== 1) return 'Exactly one starting trigger is required before deploy.';
    const invalidScheduled = items.find((trigger) => trigger.triggerType === 'scheduled' && trigger.typeConfig?.scheduleMode !== 'current_timestamp' && !isValidCronExpression(trigger.typeConfig?.cronExpression ?? ''));
    if (invalidScheduled) return `Scheduled trigger "${invalidScheduled.name}" needs a valid 5-field cron expression.`;
    const invalidContract = items.find((trigger) => trigger.triggerType === 'contract_event' && validateContractEventConfig(withContractDefaults(trigger.typeConfig?.contractEvent)));
    if (invalidContract) return `Contract trigger "${invalidContract.name}" is incomplete: ${validateContractEventConfig(withContractDefaults(invalidContract.typeConfig?.contractEvent))}`;
    const resultError = validateResultMappings(items);
    if (resultError) return resultError;
    return null;
  };

  const deployTriggers = async () => {
    const validationError = validateDeploy(triggers);
    if (validationError) {
      setMessage(validationError);
      setMessageTone('error');
      return;
    }
    setIsDeploying(true);
    const saved = await Promise.all(triggers.map((trigger) => saveTrigger(trigger)));
    const nextTriggers = saved.filter((trigger): trigger is TriggerDraft => Boolean(trigger));
    if (nextTriggers.length === triggers.length) {
      setTriggers(nextTriggers);
      const synced = await syncBuilderTriggers(nextTriggers);
      if (synced) {
        setMessage('Triggers deployed for runtime use and synced to the world builder.');
        setMessageTone('success');
      } else {
        setMessage('Triggers saved, but the builder graph could not be synced.');
        setMessageTone('error');
      }
    } else {
      setMessage('Some triggers could not be saved. Deployment was not completed.');
      setMessageTone('error');
    }
    setIsDeploying(false);
  };

  const syncBuilderTriggers = async (nextTriggers: TriggerDraft[]) => {
    const response = await fetch(`/api/apps/${worldId}/builder`).then((res) => res.json()).catch(() => null);
    const currentBuilder = response?.builder as WorldBuilderConfig | undefined;
    if (!currentBuilder) return false;
    const flowNodes = nextTriggers.flatMap((trigger, triggerIndex) => {
      const y = 120 + triggerIndex * 160;
      const chain = trigger.chain ?? [];
      return [
        { id: `trigger:${trigger.id}`, type: 'trigger' as const, label: trigger.name, refId: trigger.id, position: { x: 0, y } },
        { id: `trigger-source:${trigger.id}`, type: 'dataSource' as const, label: compactSourceLabel(trigger.sourceConfig), refId: trigger.sourceConfig?.sourceId ?? trigger.sourceConfig?.kind, position: { x: 260, y } },
        ...chain.map((agentId, index) => {
          const tool = (currentBuilder.agentChain ?? []).find((step) => step.stepType === 'tool' && (step.id === agentId || step.toolId === agentId));
          return {
            id: `trigger-agent:${trigger.id}:${agentId}`,
            type: tool ? 'event' as const : 'agent' as const,
            label: tool ? `Tool: ${tool.name}` : availableAgents.find((agent) => agent.id === agentId)?.name ?? agentId,
            refId: agentId,
            position: { x: 520 + index * 260, y },
          };
        }),
        { id: `trigger-output:${trigger.id}`, type: 'event' as const, label: 'State update', refId: trigger.id, position: { x: 520 + Math.max(chain.length, 1) * 260, y } },
      ];
    });
    const flowEdges = nextTriggers.flatMap((trigger) => {
      const chain = trigger.chain ?? [];
      const edgesForTrigger = [{ id: `trigger-flow:${trigger.id}:source`, source: `trigger:${trigger.id}`, target: `trigger-source:${trigger.id}`, label: 'source', weightPercent: 100 }];
      let previous = `trigger-source:${trigger.id}`;
      chain.forEach((agentId, index) => {
        const current = `trigger-agent:${trigger.id}:${agentId}`;
        edgesForTrigger.push({ id: `trigger-flow:${trigger.id}:agent:${index}`, source: previous, target: current, label: index === 0 ? 'input' : 'previous output', weightPercent: 100 });
        previous = current;
      });
      const primaryOutputWeight = trigger.outputMapping?.[0]?.weightPercent ?? trigger.outputMapping?.[0]?.priorityPercent ?? 100;
      edgesForTrigger.push({ id: `trigger-flow:${trigger.id}:output`, source: previous, target: `trigger-output:${trigger.id}`, label: 'updates', weightPercent: primaryOutputWeight });
      for (const mapping of trigger.outputMapping ?? []) {
        if ((mapping.target === 'zone' || mapping.target === 'faction') && mapping.targetId) {
          edgesForTrigger.push({
            id: `trigger-flow:${trigger.id}:${mapping.target}:${mapping.targetId}:${mapping.path ?? 'output'}`,
            source: `trigger-output:${trigger.id}`,
            target: `${mapping.target}:${mapping.targetId}`,
            label: mapping.path ?? 'output',
            weightPercent: mapping.weightPercent ?? mapping.priorityPercent ?? 100,
          });
        }
      }
      return edgesForTrigger;
    });
    const builder: WorldBuilderConfig = {
      ...currentBuilder,
      triggers: nextTriggers.map((trigger) => ({
        id: trigger.id,
        name: trigger.name,
        type: trigger.triggerType ?? 'data_condition',
        sourceId: trigger.sourceConfig?.sourceId ?? trigger.sourceConfig?.kind ?? trigger.feedType,
        sourceConfig: trigger.sourceConfig,
        typeConfig: trigger.typeConfig,
        outputMapping: trigger.outputMapping,
        condition: {
          label: trigger.conditionLabel,
          inputParser: trigger.inputParser ?? '',
          isStartTrigger: Boolean(trigger.isStartTrigger),
          cooldownMs: trigger.cooldownMs,
          executionLane: trigger.executionLane,
          sourceConfig: trigger.sourceConfig,
          typeConfig: trigger.typeConfig,
        },
        agentChain: trigger.chain ?? [],
        isActive: trigger.isActive,
      })),
      manualActions: [
        ...(currentBuilder.manualActions ?? []).filter((action) => !nextTriggers.some((trigger) => action.triggerId === trigger.id)),
        ...nextTriggers
          .filter((trigger) => trigger.triggerType === 'manual_action')
          .map((trigger) => ({
            id: `run-${trigger.id}`,
            label: trigger.typeConfig?.buttonLabel || trigger.name,
            description: trigger.typeConfig?.description,
            triggerId: trigger.id,
            ownerOnly: true,
          })),
      ],
      graph: {
        nodes: [
          ...((currentBuilder.graph?.nodes ?? []).filter((node) => !node.id.startsWith('trigger'))),
          ...flowNodes,
        ],
        edges: [
          ...((currentBuilder.graph?.edges ?? []).filter((edge) => !edge.id.startsWith('trigger-flow:'))),
          ...flowEdges,
        ],
      },
    };
    const savedBuilder = await fetch(`/api/apps/${worldId}/builder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ builder }),
    }).then((res) => res.json()).catch(() => null);
    if (savedBuilder?.error || !savedBuilder?.builder) return false;
    if (savedBuilder?.world) {
      cacheServerWorld(savedBuilder.world);
      queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
        [savedBuilder.world as WorldSummary, ...current.filter((item) => item.id !== savedBuilder.world.id)]
      ));
    }
    return true;
  };

  const deleteSelectedTrigger = async () => {
    if (!selectedTrigger) return;
    if (!window.confirm(`Delete trigger "${selectedTrigger.name}"?`)) return;
    setDeletingTrigger(true);
    if (!selectedTrigger.isDraft && !selectedTrigger.id.startsWith('draft-')) {
      const response = await fetch(`/api/triggers/${selectedTrigger.id}`, { method: 'DELETE' }).then((res) => res.json()).catch(() => null);
      if (response?.error) {
        setMessage(response.error);
        setMessageTone('error');
        setDeletingTrigger(false);
        return;
      }
    }
    const nextTriggers = triggers.filter((trigger) => trigger.id !== selectedTrigger.id);
    setTriggers(nextTriggers);
    setSelectedTriggerId(null);
    router.replace(worldUrl({ id: worldId, name: world?.name, slug: worldSlug }, '/triggers'), { scroll: false });
    setMessage('Trigger deleted.');
    setMessageTone('success');
    setDeletingTrigger(false);
  };

  const addAgentToChain = () => {
    if (!selectedTrigger || !agentToAdd) return;
    const nextChain = [...(selectedTrigger.chain ?? []), agentToAdd].filter((agentId, index, list) => list.indexOf(agentId) === index);
    patchSelectedTrigger({ chain: nextChain, agentName: `${nextChain.length} chained agents` });
    setAgentToAdd('');
  };

  const removeAgentFromChain = (agentId: string) => {
    if (!selectedTrigger) return;
    const nextChain = (selectedTrigger.chain ?? []).filter((id) => id !== agentId);
    patchSelectedTrigger({ chain: nextChain, agentName: nextChain.length ? `${nextChain.length} chained agents` : 'Agent Chain' });
  };

  const updateSource = (value: string) => {
    const option = sourceOptions.find((item) => item.value === value);
    if (!option) return;
    const sourceConfig = { ...option.config, path: defaultPathForSource(option.config) };
    patchSelectedTrigger({ sourceConfig, feedType: feedTypeForSource(sourceConfig) });
  };

  const updateTypeConfig = (patch: Partial<TriggerTypeConfig>) => {
    patchSelectedTrigger({ typeConfig: { ...(selectedTrigger?.typeConfig ?? {}), ...patch } });
  };

  const updateContractEventConfig = (patch: Partial<ContractEventConfig>) => {
    const current = withContractDefaults(selectedTrigger?.typeConfig?.contractEvent);
    const next = withContractDefaults({ ...current, ...patch });
    updateTypeConfig({ contractEvent: next, contractEventName: next.eventName });
  };

  const updateContractMode = (mode: ContractEventMode) => {
    const current = withContractDefaults(selectedTrigger?.typeConfig?.contractEvent);
    const next = withContractDefaults({
      mode,
      emitterAddress: current.emitterAddress || worldContractAddress,
      gasLimit: current.gasLimit,
      eventName: mode === 'world_abi' ? 'AgentDecisionReceived' : '',
      eventSignature: '',
      abiJson: '',
      topic0: mode === 'raw_topics' ? current.topic0 : '',
      topic1: '',
      topic2: '',
      topic3: '',
      dataPoints: [],
    });
    updateTypeConfig({ contractEvent: next, contractEventName: next.eventName });
  };

  const updateContractDataPoint = (pointId: string, patch: Partial<ContractEventDataPoint>) => {
    const current = withContractDefaults(selectedTrigger?.typeConfig?.contractEvent);
    const dataPoints = normalizeContractEventDataPoints(current).map((point) => (
      point.id === pointId
        ? { ...point, ...patch, alias: patch.alias !== undefined ? sanitizePayloadAlias(patch.alias, point.alias) : point.alias }
        : point
    ));
    updateContractEventConfig({ dataPoints });
  };

  const updateSourceConfig = (patch: Partial<TriggerSourceConfig>) => {
    patchSelectedTrigger({ sourceConfig: { ...(selectedTrigger?.sourceConfig ?? defaultSourceConfig(selectedTrigger?.triggerType ?? 'data_condition')), ...patch } });
  };

  const defaultOutputMapping = (target: TriggerOutputMapping['target'] = 'faction'): TriggerOutputMapping => ({
    target,
    targetId: target === 'faction' ? factionTargets[0]?.id : target === 'zone' ? zoneTargets[0]?.id : target === 'world_state' ? 'world' : 'event',
    path: target === 'event' ? 'description' : 'latestDecision',
    valueTemplate: '{{previous.output}}',
  });

  const addOutputMapping = () => {
    if (!selectedTrigger) return;
    patchSelectedTrigger({ outputMapping: normalizeOutputAllocations([...(selectedTrigger.outputMapping ?? []), defaultOutputMapping()]) });
  };

  const updateOutputMapping = (index: number, patch: Partial<TriggerOutputMapping>) => {
    if (!selectedTrigger) return;
    const current = selectedTrigger.outputMapping && selectedTrigger.outputMapping.length > 0
      ? selectedTrigger.outputMapping
      : [defaultOutputMapping()];
    const next = current.map((mapping, itemIndex) => {
      if (itemIndex !== index) return mapping;
      const patched = { ...mapping, ...patch };
      if (patch.target) {
        return { ...defaultOutputMapping(patch.target), ...patched, target: patch.target };
      }
      return patched;
    });
    patchSelectedTrigger({ outputMapping: normalizeOutputAllocations(next) });
  };

  const removeOutputMapping = (index: number) => {
    if (!selectedTrigger) return;
    const next = (selectedTrigger.outputMapping ?? []).filter((_item, itemIndex) => itemIndex !== index);
    patchSelectedTrigger({ outputMapping: normalizeOutputAllocations(next.length > 0 ? next : [defaultOutputMapping()]) });
  };

  const outputMappings = selectedTrigger?.outputMapping && selectedTrigger.outputMapping.length > 0 ? selectedTrigger.outputMapping : [defaultOutputMapping()];
  const selectedResultKeyValid = outputMappings.every((mapping) => mapping.target === 'event' || !mapping.path || isResultStateKey(mapping.path));
  const selectedContractEvent = selectedTrigger?.triggerType === 'contract_event'
    ? withContractDefaults(selectedTrigger.typeConfig?.contractEvent)
    : null;
  const selectedContractPoints = selectedContractEvent ? normalizeContractEventDataPoints(selectedContractEvent) : [];
  const selectedContractPayloadPreview = selectedContractEvent
    ? buildContractEventPayload(selectedContractEvent, {
        address: selectedContractEvent.emitterAddress,
        blockNumber: 123456,
        transactionHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        logIndex: 0,
        topics: [selectedContractEvent.topic0 || '0x', selectedContractEvent.topic1, selectedContractEvent.topic2, selectedContractEvent.topic3].filter((topic): topic is string => Boolean(topic)),
        data: '0x',
      })
    : null;

  const triggerListPanel = (
    <section className="glass-panel p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-semibold">World Triggers</h2>
          <p className="text-sm text-text-muted mt-1">Select one trigger to open its flow editor. Deploy publishes saved flows into the builder graph and runtime.</p>
        </div>
        <p className="text-xs font-mono text-text-muted">{triggers.length} trigger{triggers.length === 1 ? '' : 's'}</p>
      </div>
      {triggers.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {triggers.map((trigger) => (
            <button
              key={trigger.id}
              onClick={() => selectTrigger(trigger.id)}
              className="w-full rounded-lg border border-dream/15 bg-void/40 p-4 text-left transition-colors hover:border-teal/40 hover:bg-teal/10"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary truncate">{trigger.name}</p>
                  <p className="mt-1 text-xs font-mono text-text-muted break-all">{trigger.id}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {trigger.isStartTrigger && <span className="rounded-full border border-aurora/30 bg-aurora/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-aurora">Start</span>}
                  {trigger.isDraft && <span className="rounded-full border border-dream/30 bg-dream/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-dream">Draft</span>}
                  {!trigger.isActive && <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">Inactive</span>}
                </div>
              </div>
              <p className="mt-3 text-xs text-text-muted">{trigger.triggerType ?? 'data_condition'} · {compactSourceLabel(trigger.sourceConfig)}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="border border-dream/15 bg-void/40 rounded-lg p-4 text-sm text-text-muted">
          No triggers yet. Add Trigger creates a new local draft for this world; Save Trigger persists it.
        </div>
      )}
    </section>
  );

  return (
    <div className="max-w-7xl mx-auto w-full space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <a href={worldHref} className="mb-4 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
            <ArrowLeft className="w-4 h-4" /> Back to world
          </a>
          <h1 className="text-3xl font-display font-bold mb-1">Triggers & Reactivity</h1>
          <p className="text-text-muted">Create draft triggers, select builder sources, and chain active world agents.</p>
          <p className="text-xs text-text-muted font-mono mt-1">World: {world?.name ?? worldId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={addTrigger} className="px-4 py-2 border border-dream/30 hover:bg-dream/10 text-text-primary font-medium rounded-lg transition-colors flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Trigger
          </button>
          <button
            onClick={deployTriggers}
            disabled={isDeploying || triggers.length === 0}
            className="px-4 py-2 bg-teal hover:bg-teal/80 text-void font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-70"
          >
            {isDeploying ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            {isDeploying ? 'Deploying...' : 'Deploy Triggers'}
          </button>
        </div>
      </div>

      <div className={`rounded-lg border px-4 py-3 text-sm ${
        messageTone === 'success'
          ? 'border-teal/25 bg-teal/10 text-teal'
          : messageTone === 'error'
            ? 'border-red-500/25 bg-red-500/10 text-red-300'
            : 'border-dream/15 bg-surface/70 text-text-muted'
      }`}>
        {message}
      </div>

      {!selectedTrigger ? triggerListPanel : (
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_440px] gap-5 min-h-[calc(100vh-12rem)]">
        <div className="glass-panel rounded-xl overflow-hidden relative min-h-[620px] reverie-flow">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => selectTrigger(String(node.data?.triggerId ?? node.id.split(':')[0]))}
            fitView
            className="bg-void/50"
          >
            <Background color="#66E9D3" gap={16} size={1} style={{ opacity: 0.22 }} />
            <Controls className="reverie-flow-controls" />
            <MiniMap className="reverie-flow-minimap" nodeColor={(node) => node.id.includes(':source') ? '#66E9D3' : node.id.includes(':agent') ? '#9B7FE8' : '#F3B6FF'} maskColor="rgba(4, 31, 26, 0.28)" />
          </ReactFlow>
          <div className="absolute top-4 left-4 p-4 glass-panel bg-surface/85 max-w-sm">
            <h3 className="font-medium flex items-center gap-2 mb-2"><Zap className="w-4 h-4 text-teal" /> Trigger Flow</h3>
            <div className="space-y-2 text-xs font-mono bg-void/50 p-2 rounded border border-dream/10">
              <div className="flex items-center justify-between gap-4"><span className="text-text-muted">Triggers:</span><span>{triggers.length}</span></div>
              <div className="flex items-center justify-between gap-4"><span className="text-text-muted">Starting:</span><span className="text-aurora">{triggers.find((trigger) => trigger.isStartTrigger)?.name ?? 'None'}</span></div>
              <div className="flex items-center justify-between gap-4"><span className="text-text-muted">Drafts:</span><span className="text-dream">{triggers.filter((trigger) => trigger.isDraft).length}</span></div>
            </div>
          </div>
        </div>

        <aside className="glass-panel p-5 h-fit xl:sticky xl:top-24 space-y-5 max-w-full overflow-hidden">
          <div>
            <h2 className="text-lg font-display font-semibold flex items-center gap-2"><GitBranch className="w-5 h-5 text-dream" /> Trigger Editor</h2>
            <p className="text-sm text-text-muted mt-1">
              {selectedTrigger ? 'Edit the selected trigger flow.' : 'Select a trigger or create a new draft.'}
            </p>
          </div>

          {!selectedTrigger ? (
            <div className="space-y-3">
              {triggers.length > 0 ? triggers.map((trigger) => (
                <button
                  key={trigger.id}
                  onClick={() => selectTrigger(trigger.id)}
                  className="w-full rounded-lg border border-dream/15 bg-void/40 p-4 text-left transition-colors hover:border-teal/40 hover:bg-teal/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary truncate">{trigger.name}</p>
                      <p className="mt-1 text-xs font-mono text-text-muted break-all">{trigger.id}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {trigger.isStartTrigger && <span className="rounded-full border border-aurora/30 bg-aurora/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-aurora">Start</span>}
                      {trigger.isDraft && <span className="rounded-full border border-dream/30 bg-dream/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-dream">Draft</span>}
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-text-muted">{trigger.triggerType ?? 'data_condition'} · {compactSourceLabel(trigger.sourceConfig)}</p>
                </button>
              )) : (
                <div className="border border-dream/15 bg-void/40 rounded-lg p-4 text-sm text-text-muted">
                  No triggers yet. Add Trigger creates a new local draft for this world; Save Trigger persists it.
                </div>
              )}
              {triggers.length > 0 && (
                <p className="text-xs text-text-muted">
                  Deploy Triggers is the step that publishes saved trigger flows into the world builder graph and runtime.
                </p>
              )}
            </div>
          ) : (
            <>
              <button onClick={showTriggerList} className="text-sm text-teal hover:text-aurora transition-colors">
                Back to trigger list
              </button>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-sm text-text-muted">Name</span>
                  <input value={selectedTrigger.name} onChange={(event) => patchSelectedTrigger({ name: event.target.value })} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2" />
                </label>
                <label className="block">
                  <span className="text-sm text-text-muted">Condition label</span>
                  <input value={selectedTrigger.conditionLabel} onChange={(event) => patchSelectedTrigger({ conditionLabel: event.target.value })} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block min-w-0">
                    <span className="text-sm text-text-muted">Trigger type</span>
                    <select value={selectedTrigger.triggerType ?? 'data_condition'} onChange={(event) => updateTriggerType(event.target.value as TriggerType)} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2">
                      {triggerTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <span className="text-sm text-text-muted">Execution lane</span>
                    <select value={selectedTrigger.executionLane} onChange={(event) => patchSelectedTrigger({ executionLane: event.target.value as ExecutionLane })} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2">
                      {executionLanes.map((lane) => <option key={lane} value={lane}>{lane}</option>)}
                    </select>
                  </label>
                </div>
                {selectedTrigger.triggerType !== 'contract_event' && (
                  <>
                    <label className="block">
                      <span className="text-sm text-text-muted">Source</span>
                      <select value={sourceKey(selectedTrigger.sourceConfig)} onChange={(event) => updateSource(event.target.value)} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2">
                        <option value="">Select builder/runtime source</option>
                        {filteredSourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <p className="mt-2 text-xs text-text-muted">
                        The selected source is resolved before the agent chain. Its selected value becomes <code className="font-mono text-teal">{'{{source.value}}'}</code>; the full trigger payload is available as <code className="font-mono text-teal">{'{{trigger.payload}}'}</code>.
                      </p>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-sm text-text-muted">Read value path</span>
                        {sourcePathOptions.length > 0 ? (
                          <select value={selectedTrigger.sourceConfig?.path ?? ''} onChange={(event) => updateSourceConfig({ path: event.target.value || undefined })} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2">
                            {sourcePathOptions.map((option) => <option key={option.value || 'value'} value={option.value}>{option.label}</option>)}
                          </select>
                        ) : (
                          <input
                            value={selectedTrigger.sourceConfig?.path ?? ''}
                            onChange={(event) => updateSourceConfig({ path: event.target.value })}
                            placeholder={selectedTrigger.sourceConfig?.kind === 'data_source' ? 'body.current.wind_speed' : 'payload.value'}
                            className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2 placeholder:text-text-muted/50"
                          />
                        )}
                      </label>
                      <label className="block">
                        <span className="text-sm text-text-muted">Cooldown ms</span>
                        <input type="number" min={0} value={selectedTrigger.cooldownMs} onChange={(event) => patchSelectedTrigger({ cooldownMs: Number(event.target.value) })} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2" />
                      </label>
                    </div>
                  </>
                )}
                {selectedTrigger.sourceConfig?.kind === 'data_source' && selectedTrigger.triggerType !== 'contract_event' && (
                  <label className="block">
                    <span className="text-sm text-text-muted">POST body template</span>
                    <textarea value={selectedTrigger.sourceConfig.requestBodyTemplate ?? ''} onChange={(event) => updateSourceConfig({ requestBodyTemplate: event.target.value })} rows={3} placeholder={'{"name":"{{runtime.inputs.name}}"}'} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2 font-mono text-xs placeholder:text-text-muted/50" />
                  </label>
                )}
                {selectedTrigger.triggerType === 'manual_action' && (
                  <div className="rounded-lg border border-dream/10 bg-void/40 p-3 space-y-3">
                    <input value={selectedTrigger.typeConfig?.buttonLabel ?? ''} onChange={(event) => updateTypeConfig({ buttonLabel: event.target.value })} placeholder="Runtime button label" className="w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    <input value={selectedTrigger.typeConfig?.description ?? ''} onChange={(event) => updateTypeConfig({ description: event.target.value })} placeholder="Description" className="w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    <label className="block">
                      <span className="text-sm text-text-muted">Runtime payload template</span>
                      <textarea
                        value={selectedTrigger.typeConfig?.payloadTemplate ?? ''}
                        onChange={(event) => updateTypeConfig({ payloadTemplate: event.target.value })}
                        rows={4}
                        placeholder={'{\n  "note": "manual owner action",\n  "input": "{{runtime.inputs}}"\n}'}
                        className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-xs placeholder:text-text-muted/50"
                      />
                      <p className="mt-2 text-xs text-text-muted">This JSON becomes the manual trigger payload, so it can feed the input parser or first agent.</p>
                    </label>
                  </div>
                )}
                {selectedTrigger.triggerType === 'scheduled' && (
                  <label className="block rounded-lg border border-dream/10 bg-void/40 p-3">
                    <span className="text-sm text-text-muted">Cron expression (UTC)</span>
                    <input value={selectedTrigger.typeConfig?.cronExpression ?? ''} onChange={(event) => updateTypeConfig({ cronExpression: event.target.value, timezone: 'UTC', scheduleMode: 'cron', scheduleTimestampMs: undefined })} placeholder="*/5 * * * *" className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono placeholder:text-text-muted/50" />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateTypeConfig({ scheduleMode: 'current_timestamp', scheduleTimestampMs: Date.now() + 15_000, timezone: 'UTC' })}
                        className="rounded border border-teal/30 px-3 py-1.5 text-xs text-teal hover:bg-teal/10"
                      >
                        Use current timestamp once
                      </button>
                      {selectedTrigger.typeConfig?.scheduleMode === 'current_timestamp' && (
                        <span className="text-xs text-text-muted">
                          {selectedTrigger.typeConfig.scheduleTimestampMs
                            ? `One-shot at ${new Date(selectedTrigger.typeConfig.scheduleTimestampMs).toLocaleString()}`
                            : 'One-shot at the browser timestamp selected when you save.'}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                      Somnia Schedule is configured automatically. Fixed minute/hour intervals and single-weekday schedules like 0 9 * * mon deploy live. Use current timestamp creates a one-shot browser-time subscription; cron stays available for recurring schedules.
                    </p>
                  </label>
                )}
                {selectedTrigger.triggerType === 'data_condition' && (
                  <div className="rounded-lg border border-dream/10 bg-void/40 p-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm text-text-muted">
                      <input
                        type="checkbox"
                        checked={selectedTrigger.typeConfig?.conditionEnabled ?? true}
                        onChange={(event) => updateTypeConfig({ conditionEnabled: event.target.checked })}
                        className="accent-dream"
                      />
                      Use condition check before this trigger runs
                    </label>
                    {(selectedTrigger.typeConfig?.conditionEnabled ?? true) && (
                      <div className={`grid grid-cols-1 ${(selectedTrigger.typeConfig?.operator ?? 'exists') === 'exists' ? '' : 'md:grid-cols-2'} gap-3`}>
                        <select
                          value={selectedTrigger.typeConfig?.operator ?? 'exists'}
                          onChange={(event) => updateTypeConfig({ operator: event.target.value as TriggerTypeConfig['operator'], compareValue: event.target.value === 'exists' ? '' : selectedTrigger.typeConfig?.compareValue })}
                          className="bg-surface border border-dream/20 rounded px-3 py-2"
                        >
                          {operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                        </select>
                        {(selectedTrigger.typeConfig?.operator ?? 'exists') !== 'exists' && (
                          <input
                            value={selectedTrigger.typeConfig?.compareValue ?? ''}
                            onChange={(event) => updateTypeConfig({ compareValue: event.target.value })}
                            placeholder="Value to compare against"
                            className="bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
                {selectedTrigger.triggerType === 'contract_event' && (
                  <div className="rounded-lg border border-dream/10 bg-void/40 p-3 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-sm text-text-muted">Event mode</span>
                        <select
                          value={selectedContractEvent?.mode ?? 'world_abi'}
                          onChange={(event) => updateContractMode(event.target.value as ContractEventMode)}
                          className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2"
                        >
                          {contractModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-sm text-text-muted">Emitter address</span>
                        <input
                          value={selectedContractEvent?.emitterAddress ?? worldContractAddress}
                          onChange={(event) => updateContractEventConfig({ emitterAddress: event.target.value })}
                          placeholder={worldContractAddress || '0x contract address'}
                          className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-xs placeholder:text-text-muted/50"
                        />
                      </label>
                    </div>

                    {selectedContractEvent?.mode === 'world_abi' && (
                      <label className="block">
                        <span className="text-sm text-text-muted">REVERIE world event</span>
                        <select
                          value={selectedContractEvent.eventName ?? 'AgentDecisionReceived'}
                          onChange={(event) => {
                            const known = getKnownWorldEvent(event.target.value);
                            updateContractEventConfig({
                              eventName: known.name,
                              eventSignature: known.signature,
                              topic0: known.topic0,
                              dataPoints: contractEventDataPointOptions({ ...selectedContractEvent, mode: 'world_abi', eventName: known.name, eventSignature: known.signature, topic0: known.topic0 }),
                            });
                          }}
                          className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2"
                        >
                          {knownWorldEvents().map((event) => <option key={event.name} value={event.name}>{event.name}</option>)}
                        </select>
                      </label>
                    )}

                    {selectedContractEvent?.mode === 'custom_abi' && (
                      <div className="space-y-3">
                        <label className="block">
                          <span className="text-sm text-text-muted">ABI JSON</span>
                          <textarea
                            value={selectedContractEvent.abiJson ?? ''}
                            onChange={(event) => updateContractEventConfig({ abiJson: event.target.value })}
                            rows={4}
                            placeholder={'[{"type":"event","name":"Transfer","inputs":[{"name":"from","type":"address","indexed":true}]}]'}
                            className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-xs placeholder:text-text-muted/50"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm text-text-muted">Event signature fallback</span>
                          <input
                            value={selectedContractEvent.eventSignature ?? ''}
                            onChange={(event) => updateContractEventConfig({ eventSignature: event.target.value })}
                            placeholder="Transfer(address indexed from,address indexed to,uint256 value)"
                            className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-xs placeholder:text-text-muted/50"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm text-text-muted">Parsed event</span>
                          <select
                            value={selectedContractEvent.eventName ?? ''}
                            onChange={(event) => updateContractEventConfig({ eventName: event.target.value })}
                            className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2"
                          >
                            <option value="">Select parsed event</option>
                            {customContractEventChoices(selectedContractEvent).map((event) => <option key={event.signature} value={event.name}>{event.name}</option>)}
                          </select>
                        </label>
                      </div>
                    )}

                    {selectedContractEvent?.mode === 'raw_topics' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {(['topic0', 'topic1', 'topic2', 'topic3'] as const).map((topic) => (
                          <label key={topic} className="block">
                            <span className="text-sm text-text-muted">{topic}</span>
                            <input
                              value={selectedContractEvent[topic] ?? ''}
                              onChange={(event) => updateContractEventConfig({ [topic]: event.target.value })}
                              placeholder={topic === 'topic0' ? '0x event topic hash' : 'optional indexed topic'}
                              className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-xs placeholder:text-text-muted/50"
                            />
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-sm text-text-muted">Derived topic0</span>
                        <input readOnly value={selectedContractEvent ? contractEventTopic0(selectedContractEvent) ?? '' : ''} className="mt-2 w-full bg-surface/60 border border-dream/20 rounded px-3 py-2 font-mono text-xs text-text-muted" />
                      </label>
                      <label className="block">
                        <span className="text-sm text-text-muted">On-chain subscription gas limit</span>
                        <input
                          type="number"
                          min={100000}
                          value={selectedContractEvent?.gasLimit ?? 500000}
                          onChange={(event) => updateContractEventConfig({ gasLimit: Number(event.target.value) })}
                          className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2"
                        />
                      </label>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-text-muted">Datapoints</p>
                      <div className="max-h-72 overflow-y-auto rounded-lg border border-dream/10">
                        {selectedContractPoints.map((point) => (
                          <div key={point.id} className="grid grid-cols-1 gap-2 border-b border-dream/10 bg-surface/40 p-3 last:border-b-0">
                            <label className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={point.include}
                                onChange={(event) => updateContractDataPoint(point.id, { include: event.target.checked })}
                                className="mt-1 accent-dream"
                              />
                              <span>
                                <span className="block font-medium">{point.label ?? point.id}</span>
                                <span className="block text-xs font-mono text-text-muted">{point.path}</span>
                              </span>
                            </label>
                            {point.include && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <input
                                  value={point.alias}
                                  onChange={(event) => updateContractDataPoint(point.id, { alias: event.target.value })}
                                  placeholder="payloadAlias"
                                  className="bg-void border border-dream/20 rounded px-3 py-2 font-mono text-xs placeholder:text-text-muted/50"
                                />
                                <label className="flex items-center gap-2 text-xs text-text-muted">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(point.condition?.enabled)}
                                    onChange={(event) => updateContractDataPoint(point.id, { condition: { ...(point.condition ?? {}), enabled: event.target.checked } })}
                                    className="accent-teal"
                                  />
                                  Use condition
                                </label>
                                {point.condition?.enabled && (
                                  <>
                                    <select
                                      value={point.condition?.operator ?? 'exists'}
                                      onChange={(event) => updateContractDataPoint(point.id, { condition: { ...(point.condition ?? {}), operator: event.target.value as NonNullable<ContractEventDataPoint['condition']>['operator'], compareValue: event.target.value === 'exists' ? '' : point.condition?.compareValue } })}
                                      className="bg-void border border-dream/20 rounded px-3 py-2 text-xs"
                                    >
                                      {operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                                    </select>
                                    {(point.condition?.operator ?? 'exists') !== 'exists' && (
                                      <input
                                        value={point.condition?.compareValue ?? ''}
                                        onChange={(event) => updateContractDataPoint(point.id, { condition: { ...(point.condition ?? {}), compareValue: event.target.value } })}
                                        placeholder="Expected value"
                                        className="bg-void border border-dream/20 rounded px-3 py-2 text-xs placeholder:text-text-muted/50"
                                      />
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-text-muted mb-2">Payload preview</p>
                      <pre className="max-h-52 overflow-auto rounded-lg border border-dream/10 bg-void p-3 text-xs text-text-muted">{JSON.stringify(selectedContractPayloadPreview?.payload ?? {}, null, 2)}</pre>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={selectedTrigger.isActive} onChange={(event) => patchSelectedTrigger({ isActive: event.target.checked })} className="accent-dream" />Active</label>
                  <label className="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={Boolean(selectedTrigger.isStartTrigger)} onChange={(event) => patchSelectedTrigger({ isStartTrigger: event.target.checked })} className="accent-aurora" />Starting trigger</label>
                </div>
              </div>

              <div className="border-t border-dream/10 pt-5 space-y-3 min-w-0">
                <h3 className="font-medium flex items-center gap-2"><Bot className="w-4 h-4 text-teal" /> Agent Chain</h3>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <select value={agentToAdd} onChange={(event) => setAgentToAdd(event.target.value)} className="min-w-0 bg-void border border-dream/30 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select active world agent or tool</option>
                    {availableAgents.filter((agent) => !(selectedTrigger.chain ?? []).includes(agent.id)).map((agent) => <option key={agent.id} value={agent.id}>{agentName(agent)}</option>)}
                    {availableToolSteps.filter((tool) => !(selectedTrigger.chain ?? []).includes(tool.id)).map((tool) => <option key={tool.id} value={tool.id}>Tool: {tool.name}</option>)}
                  </select>
                  <button onClick={addAgentToChain} disabled={!agentToAdd} className="px-3 py-2 border border-dream/30 rounded-lg text-sm disabled:opacity-50">Add</button>
                </div>
                {availableAgents.length === 0 && availableToolSteps.length === 0 && <p className="text-xs text-text-muted">No active agents or deployed tools are attached to this world yet.</p>}
                <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                  {selectedChainSteps.map((step, index) => (
                    <div key={step.id} className="flex items-center justify-between gap-3 bg-void/50 border border-dream/10 rounded-lg px-3 py-2">
                      <span className="min-w-0 truncate text-sm"><span className="text-text-muted font-mono mr-2">{index + 1}</span>{step.label}</span>
                      <button onClick={() => removeAgentFromChain(step.id)} className="shrink-0 text-xs text-red-300">Remove</button>
                    </div>
                  ))}
                  {selectedChainSteps.length === 0 && <p className="text-sm text-text-muted">No agents or tools chained yet.</p>}
                </div>
              </div>

              <label className="block border-t border-dream/10 pt-5">
                <span className="text-sm text-text-muted">Input parser / payload mapping</span>
                <p className="mt-2 text-xs text-text-muted">
                  Optional JSON mapping for the first agent input. Use double-curly placeholders such as <code className="font-mono text-teal">{'{{runtime.inputs.startPort}}'}</code>, <code className="font-mono text-teal">{'{{source.value}}'}</code>, <code className="font-mono text-teal">{'{{trigger.payload}}'}</code>, <code className="font-mono text-teal">{'{{worldState.factions}}'}</code>, and later in the chain <code className="font-mono text-teal">{'{{previous.output}}'}</code>. If left empty, the trigger payload is sent as-is.
                </p>
                <textarea value={selectedTrigger.inputParser ?? ''} onChange={(event) => patchSelectedTrigger({ inputParser: event.target.value })} rows={7} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-3 py-2 font-mono text-xs" placeholder={'{\n  "payload": "{{runtime.inputs}}"\n}'} />
              </label>
              <div className="border-t border-dream/10 pt-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium">State Effects</h3>
                    <p className="text-xs text-text-muted">Map this workflow output to zones, factions, world state, or event records.</p>
                  </div>
                  <button onClick={addOutputMapping} className="rounded-lg border border-dream/30 px-3 py-2 text-sm">Add Effect</button>
                </div>
                {outputMappings.map((mapping, index) => {
                  const targetOptions = mapping.target === 'zone'
                    ? zoneTargets
                    : mapping.target === 'faction'
                      ? factionTargets
                      : [];
                  return (
                    <div key={`${mapping.target}:${index}`} className="rounded-lg border border-dream/10 bg-void/40 p-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-[130px_minmax(0,1fr)] gap-3">
                        <label className="block">
                          <span className="text-sm text-text-muted">Effect type</span>
                          <select value={mapping.target} onChange={(event) => updateOutputMapping(index, { target: event.target.value as TriggerOutputMapping['target'] })} className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2">
                            <option value="faction">Faction</option>
                            <option value="zone">Zone</option>
                            <option value="world_state">World state</option>
                            <option value="event">Event</option>
                          </select>
                        </label>
                        {mapping.target === 'zone' || mapping.target === 'faction' ? (
                          <label className="block">
                            <span className="text-sm text-text-muted">Target</span>
                            <select value={mapping.targetId ?? ''} onChange={(event) => updateOutputMapping(index, { targetId: event.target.value })} className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2">
                              <option value="">Select target</option>
                              {targetOptions.map((target) => <option key={target.id} value={target.id}>{target.name ?? target.id}</option>)}
                            </select>
                          </label>
                        ) : (
                          <label className="block">
                            <span className="text-sm text-text-muted">Target ID</span>
                            <input value={mapping.targetId ?? (mapping.target === 'world_state' ? 'world' : 'event')} onChange={(event) => updateOutputMapping(index, { targetId: event.target.value })} className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm" />
                          </label>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px] gap-3">
                        <label className="block">
                          <span className="text-sm text-text-muted">State key</span>
                          <input
                            value={mapping.path ?? ''}
                            onChange={(event) => {
                              const nextValue = event.target.value || (mapping.target === 'event' ? 'description' : 'latestDecision');
                              if (mapping.target !== 'event' && !isResultStateKey(nextValue)) {
                                setMessage('State key must be lowercase or camelCase, for example latestDecision or finalDecision.');
                                setMessageTone('error');
                                return;
                              }
                              updateOutputMapping(index, { path: nextValue });
                            }}
                            placeholder={mapping.target === 'event' ? 'description' : 'latestDecision'}
                            className={`mt-2 w-full bg-surface border rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50 ${mapping.target === 'event' || !mapping.path || isResultStateKey(mapping.path) ? 'border-dream/20' : 'border-red-500/50'}`}
                          />
                        </label>
                        <div className="block">
                          <span className="text-sm text-text-muted">Allocation</span>
                          <div className="mt-2 rounded border border-dream/10 bg-void/50 px-3 py-2 text-sm text-text-muted">
                            Auto {mapping.weightPercent ?? 100}%
                          </div>
                        </div>
                      </div>
                      <label className="block">
                        <span className="text-sm text-text-muted">Value template</span>
                        <input value={mapping.valueTemplate ?? '{{previous.output}}'} onChange={(event) => updateOutputMapping(index, { valueTemplate: event.target.value })} className="mt-2 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm" />
                      </label>
                      <button onClick={() => removeOutputMapping(index)} className="text-xs text-red-300">Remove effect</button>
                    </div>
                  );
                })}
                {!selectedResultKeyValid && <p className="text-xs text-red-300">Zone, faction, and world state keys must use lowercase or camelCase only.</p>}
              </div>

              <div className="flex gap-3 border-t border-dream/10 pt-5">
                <button onClick={saveSelectedTrigger} disabled={isDeploying || deletingTrigger} className="flex-1 px-4 py-2 bg-teal text-void rounded-lg font-semibold disabled:opacity-70">
                  {isDeploying ? 'Saving...' : 'Save Trigger'}
                </button>
                <button onClick={deleteSelectedTrigger} disabled={isDeploying || deletingTrigger} className="px-4 py-2 border border-red-500/30 text-red-300 rounded-lg flex items-center gap-2 disabled:opacity-70">
                  {deletingTrigger ? <div className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {deletingTrigger ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
      )}
    </div>
  );
}
