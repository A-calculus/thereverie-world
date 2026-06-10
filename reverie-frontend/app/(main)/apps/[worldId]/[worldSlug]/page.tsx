'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { keccak256, toBytes } from 'viem';
import { ArrowLeft, Braces, ExternalLink, GitBranch, Play, ReceiptText, Rocket, Square, Wallet, Zap } from 'lucide-react';
import { cacheServerWorld, removeCachedWorld } from '@/lib/client/query-cache';
import { compileLiveManifest, createBrowserWorldSdk, getLiveWorld } from '@/lib/client/live-world';
import { applyArmAndMaybeStartWorld } from '@/lib/client/live-lifecycle';
import { worldUrl } from '@/lib/shared/routes';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import { canonicalBaseUrl } from '@/lib/shared/base-url';
import { evmAddressUrl } from '@/lib/shared/explorer-links';
import {
  buildContractEventPayload,
  contractEventTopic0,
  contractLogKey,
  stringifyContractValue,
  type ContractLogLike,
} from '@/lib/shared/contract-events';
import type {
  ContractEventConfig,
  TriggerSourceConfig,
  TriggerTypeConfig,
  WorldBuilderGraphNode,
  WorldBuilderInputField,
  WorldBuilderTrigger,
  RuntimeTimelineItem,
  WorldRuntimeMetadata,
  WorldRuntimeRun,
  WorldSummary,
} from '@/lib/shared/types';

function inputDefault(input: WorldBuilderInputField): string {
  return input.defaultValue === undefined ? '' : String(input.defaultValue);
}

function readPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function statusTone(status: string) {
  if (['complete', 'success', 'active', 'running'].includes(status)) return 'bg-teal/10 text-teal border-teal/20';
  if (['failed', 'error', 'insufficient_budget'].includes(status)) return 'bg-red-400/10 text-red-300 border-red-400/20';
  return 'bg-dream/10 text-dream border-dream/20';
}

function receiptRequestId(url?: string) {
  if (!url) return '';
  const match = url.match(/\/receipts\/([^/?#]+)/);
  return match?.[1] ?? '';
}

function conciseAgentOutput(response: unknown, result: Record<string, unknown>, receiptDetails: Record<string, unknown>, status: string) {
  const errorMessage = String(receiptDetails.errorMessage ?? result.errorMessage ?? '');
  if (errorMessage || ['failed', 'error', 'insufficient_budget'].includes(status)) {
    return errorMessage || `Agent request ended with ${status}.`;
  }
  const candidates = [
    result.output,
    result.response,
    result.finalResult,
    objectValue(result.receiptDetails).output,
    readPath(response, 'output'),
    readPath(response, 'response'),
    readPath(response, 'result.output'),
    readPath(response, 'result.response'),
  ];
  const value = candidates.find((item) => item !== undefined && item !== null && String(item).trim().length > 0);
  if (value !== undefined && value !== null) return stringifyValue(value);
  if (Object.keys(receiptDetails).length > 0) return `Receipt status: ${status}. Expand raw details for validator payloads.`;
  return 'Waiting for agent output.';
}

function isOpaqueId(value: string): boolean {
  return /^0x[0-9a-fA-F]{16,}$/.test(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function twoWordLabel(value: string): string {
  const cleaned = value
    .replace(/^(agent|trigger|data|input|zone|faction|action):/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!cleaned) return value;
  return cleaned.split(/\s+/).slice(0, 2).join(' ');
}

function relationshipLabel(
  id: string,
  nodes: Array<{ id: string; type?: string; refId?: string; label?: string }>,
): string {
  const node = nodes.find((item) => item.id === id || item.refId === id || `${item.type}:${item.refId}` === id);
  const slugCandidate = node?.refId && !isOpaqueId(node.refId) ? node.refId : '';
  const nameCandidate = node?.label && !isOpaqueId(node.label) ? node.label : '';
  return twoWordLabel(slugCandidate || nameCandidate || id);
}

function graphNodeIdentity(node: { id: string; type: string; refId?: string }) {
  return `${node.type}:${node.refId || node.id}`;
}

function interpolatePlain(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => stringifyValue(readPath(variables, rawPath.trim())));
}

function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url.startsWith('/') ? url : `/${url}`, canonicalBaseUrl()).toString();
}

function somniaWsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SOMNIA_TESTNET_WS;
  if (explicit) return explicit;
  const rpc = process.env.NEXT_PUBLIC_SOMNIA_TESTNET_RPC || 'https://api.infra.testnet.somnia.network';
  const ws = rpc.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/+$/, '');
  return ws.endsWith('/ws') ? ws : `${ws}/ws`;
}

function compiledTriggerId(builder: { uiSlug?: string } | undefined, trigger: WorldBuilderTrigger): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(trigger.id)) return trigger.id as `0x${string}`;
  return keccak256(toBytes(`reverie:trigger:${builder?.uiSlug || 'reverie-world'}:${trigger.name || trigger.id}`));
}

function hexToNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function contractEventConfigFor(trigger: WorldBuilderTrigger): ContractEventConfig | null {
  const conditionTypeConfig = objectValue(objectValue(trigger.condition).typeConfig);
  const config = trigger.typeConfig?.contractEvent ?? conditionTypeConfig.contractEvent;
  return config && typeof config === 'object' && !Array.isArray(config) ? config as ContractEventConfig : null;
}

function contractTopicFilter(config: ContractEventConfig): Array<string | null> {
  const topic0 = contractEventTopic0(config) ?? config.topic0 ?? null;
  return [topic0, config.topic1 || null, config.topic2 || null, config.topic3 || null];
}

function evaluateConditionValue(value: unknown, typeConfig?: TriggerTypeConfig) {
  if (typeConfig?.conditionEnabled === false) return { passed: true, reason: 'Condition check is disabled for this trigger.' };
  const operator = typeConfig?.operator ?? 'exists';
  const compareValue = typeConfig?.compareValue ?? '';
  const actualValue = stringifyValue(value);
  if (operator === 'exists') {
    const passed = value !== undefined && value !== null && value !== '';
    return { passed, reason: passed ? 'Source value exists.' : 'Source value is missing, null, or empty.' };
  }
  if (operator === 'equals') return { passed: actualValue === compareValue, reason: `Actual value ${actualValue === compareValue ? 'equals' : 'does not equal'} the expected value.` };
  if (operator === 'not_equals') return { passed: actualValue !== compareValue, reason: `Actual value ${actualValue !== compareValue ? 'does not equal' : 'equals'} the blocked value.` };
  if (operator === 'contains') return { passed: actualValue.includes(compareValue), reason: `Actual value ${actualValue.includes(compareValue) ? 'contains' : 'does not contain'} the expected text.` };
  const left = Number(actualValue);
  const right = Number(compareValue);
  const numbersValid = Number.isFinite(left) && Number.isFinite(right);
  if (operator === 'greater_than') return { passed: numbersValid && left > right, reason: numbersValid ? `Numeric comparison ${left} > ${right} ${left > right ? 'passed' : 'failed'}.` : 'Numeric comparison failed because one value is not a number.' };
  if (operator === 'less_than') return { passed: numbersValid && left < right, reason: numbersValid ? `Numeric comparison ${left} < ${right} ${left < right ? 'passed' : 'failed'}.` : 'Numeric comparison failed because one value is not a number.' };
  return { passed: true, reason: 'No condition operator was configured.' };
}

export default function WorldRuntimeSlugPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const worldId = params.worldId as string;
  const worldSlug = params.worldSlug as string;
  const hostWorldSlug = useWorldSlugFromHost();
  const [metadata, setMetadata] = useState<WorldRuntimeMetadata | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [run, setRun] = useState<WorldRuntimeRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('Loading runtime...');
  const [reactivityStatus, setReactivityStatus] = useState('Contract event listeners inactive.');
  const [funding, setFunding] = useState('0.5');
  const [liveRequests, setLiveRequests] = useState<Array<Record<string, unknown>>>([]);
  const [liveSubscriptions, setLiveSubscriptions] = useState<Array<Record<string, unknown>>>([]);
  const [liveTimeline, setLiveTimeline] = useState<RuntimeTimelineItem[]>([]);
  const seenContractLogsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function loadRuntime() {
      const response = await fetch(`/api/apps/${worldId}/runtime`).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? 'Unable to load runtime.');
        return data;
      }).catch((error) => ({ error: error instanceof Error ? error.message : 'Unable to load runtime.' }));
      if (cancelled) return;
      if (response.error) {
        if (response.error === 'World not found') {
          removeCachedWorld(worldId);
          queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => current.filter((item) => item.id !== worldId));
        }
        setMessage(response.error);
        setLoading(false);
        return;
      }
      if (!response?.builder) {
        setMessage('Runtime not found.');
        setLoading(false);
        return;
      }
      setMetadata(response);
      setRun(response.latestRun ?? null);
      setInputs(Object.fromEntries((response.builder.inputSchema ?? []).map((input: WorldBuilderInputField) => [input.id, inputDefault(input)])));
      setMessage('Runtime ready.');
      setLoading(false);
      const live = await fetch(`/api/apps/${worldId}/runtime/live`).then((res) => res.json()).catch(() => ({}));
      if (!cancelled && Array.isArray(live.requests)) setLiveRequests(live.requests);
      if (!cancelled && Array.isArray(live.subscriptions)) setLiveSubscriptions(live.subscriptions);
      if (!cancelled && Array.isArray(live.timeline)) setLiveTimeline(live.timeline);
      if (!cancelled) {
        setMetadata((current) => current ? {
          ...current,
          latestActivityAt: typeof live.latestActivityAt === 'string' ? live.latestActivityAt : current.latestActivityAt,
          latestActivityKind: typeof live.latestActivityKind === 'string' ? live.latestActivityKind : current.latestActivityKind,
          latestActivitySummary: typeof live.latestActivitySummary === 'string' ? live.latestActivitySummary : current.latestActivitySummary,
        } : current);
      }
    }
    void loadRuntime();
    return () => {
      cancelled = true;
    };
  }, [queryClient, worldId]);

  const builder = metadata?.builder;
  const linkWorld = { id: worldId, name: metadata?.world.name, slug: hostWorldSlug };
  const graph = run?.graph ?? builder?.graph ?? { nodes: [], edges: [] };
  const relationshipLabels = useMemo(() => new Map((graph.edges ?? []).map((edge) => [
    edge.id,
    {
      source: relationshipLabel(edge.source, graph.nodes ?? []),
      target: relationshipLabel(edge.target, graph.nodes ?? []),
      label: edge.label ? twoWordLabel(edge.label) : '',
    },
  ])), [graph.edges, graph.nodes]);
  const graphGroups = useMemo(() => {
    const labels: Record<string, string> = {
      input: 'Inputs',
      dataSource: 'Data',
      trigger: 'Triggers',
      agent: 'Agents',
      zone: 'Zones',
      faction: 'Factions',
      manualAction: 'Manual',
      event: 'Events',
    };
    return Object.entries(labels)
      .map(([type, label]) => ({
        type,
        label,
        nodes: Array.from((graph.nodes ?? [])
          .filter((node) => node.type === type)
          .reduce((items, node) => {
            const key = graphNodeIdentity(node);
            const current = items.get(key);
            items.set(key, current
              ? { ...current, count: current.count + 1 }
              : { ...node, count: 1 });
            return items;
          }, new Map<string, WorldBuilderGraphNode & { count: number }>())
          .values()),
      }))
      .filter((group) => group.nodes.length > 0);
  }, [graph.nodes]);
  const liveAgentResponses = useMemo(() => liveRequests.map((row) => {
    const result = objectValue(row.result);
    const receiptDetails = objectValue(result.receiptDetails);
    const requestId = String(row.request_id ?? row.requestId ?? '');
    return {
      id: requestId || String(row.id ?? `${row.trigger_id ?? 'request'}-${row.step_index ?? 0}`),
      name: `${String(row.agent_kind ?? 'native agent')} request ${requestId || ''}`.trim(),
      agentType: String(row.agent_kind ?? 'native_llm'),
      triggerId: String(row.trigger_id ?? ''),
      stepIndex: row.step_index,
      request: {
        requestId,
        triggerId: row.trigger_id,
        stepIndex: row.step_index,
        transactionHash: row.transaction_hash,
      },
      response: Object.keys(result).length > 0 ? result : row,
      receiptUrl: String(row.receipt_url ?? ''),
      status: String(receiptDetails.status ?? row.status ?? row.callback_status ?? 'pending'),
      errorMessage: String(receiptDetails.errorMessage ?? ''),
    };
  }), [liveRequests]);
  const visibleActions = useMemo(() => (
    metadata?.capabilities.canRunManualActions ? builder?.manualActions ?? [] : []
  ), [builder?.manualActions, metadata?.capabilities.canRunManualActions]);
  const runtimeStatus = metadata?.publicState.runtime && typeof metadata.publicState.runtime === 'object' && !Array.isArray(metadata.publicState.runtime)
    ? String((metadata.publicState.runtime as Record<string, unknown>).status ?? metadata.world.status)
    : metadata?.world.status;
  const isPublished = Boolean(builder?.lastPublishedAt);
  const displayRuntimeStatus = runtimeStatus === metadata?.world.status && metadata?.world.status === 'draft' && isPublished
    ? 'published'
    : runtimeStatus;
  const canDeployWorld = Boolean(metadata?.capabilities.canRunManualActions && metadata.world.status === 'draft' && isPublished);
  const canFundWorld = Boolean(metadata?.capabilities.canRunManualActions && metadata.world.status !== 'draft' && metadata.world.contractAddress);
  const balanceNumber = Number.parseFloat(String(metadata?.balance ?? '0').replace(/[^\d.]/g, '')) || 0;
  const minimumBalance = metadata?.costEstimate?.minimumBalanceStt ?? 0;
  const hasMinimumFunding = balanceNumber >= minimumBalance;
  const runtimeRecord = metadata?.publicState.runtime && typeof metadata.publicState.runtime === 'object' && !Array.isArray(metadata.publicState.runtime)
    ? metadata.publicState.runtime as Record<string, unknown>
    : {};
  const requiredAutonomousTriggers = (builder?.triggers ?? []).filter((trigger) => (trigger.type === 'contract_event' || trigger.type === 'scheduled') && trigger.isActive);
  const hasAutonomousTriggers = requiredAutonomousTriggers.length > 0;
  const recordedActiveSubscriptions = liveSubscriptions.filter((subscription) => (
    ['active', 'subscribed'].includes(String(subscription.status ?? 'active')) &&
    (Boolean(subscription.subscription_id) || Boolean(subscription.subscribe_tx_hash))
  )).length;
  const runtimeSubscribed = !hasAutonomousTriggers || recordedActiveSubscriptions >= requiredAutonomousTriggers.length || (runtimeRecord.status === 'subscribed' && recordedActiveSubscriptions > 0);
  const hasStartTrigger = (builder?.triggers ?? []).some((trigger) => (
    trigger.isActive &&
    (Boolean(objectValue(trigger.condition).isStartTrigger) || Boolean((trigger as WorldBuilderTrigger & { isStartTrigger?: boolean }).isStartTrigger))
  ));
  const canSubscribeWorld = Boolean(canFundWorld && hasMinimumFunding && !runtimeSubscribed);
  const canStartWorld = Boolean(metadata?.capabilities.canRunManualActions && (metadata.world.status === 'deployed' || metadata.world.status === 'stopped') && runtimeStatus !== 'armed' && hasMinimumFunding && runtimeSubscribed && hasStartTrigger);
  const activeContractTriggers = useMemo(() => (
    (builder?.triggers ?? []).filter((trigger) => {
      const config = contractEventConfigFor(trigger);
      return trigger.type === 'contract_event' &&
        trigger.isActive &&
        Boolean(config?.emitterAddress) &&
        Boolean(contractEventTopic0(config ?? undefined) ?? config?.topic0);
    })
  ), [builder?.triggers]);
  const canListenContractEvents = Boolean(
    metadata?.capabilities.canRunManualActions &&
    (metadata.world.status === 'deployed' || metadata.world.status === 'running') &&
    activeContractTriggers.length > 0
  );
  const displayedReactivityStatus = canListenContractEvents
    ? reactivityStatus || `Connecting ${activeContractTriggers.length} contract-event listener${activeContractTriggers.length === 1 ? '' : 's'}...`
    : activeContractTriggers.length > 0
      ? 'Open this runtime as the owner on a deployed/running world to listen for contract events.'
      : 'No active contract-event triggers configured.';
  const latestActivityAt = metadata?.latestActivityAt ?? liveTimeline[0]?.createdAt ?? run?.createdAt ?? null;
  const latestActivityLabel = metadata?.latestActivityKind
    ? `${metadata.latestActivityKind}${metadata.latestActivitySummary ? ` / ${metadata.latestActivitySummary}` : ''}`
    : 'Latest trigger, transaction, agent, receipt, or state update';

  const applyWorldResponse = (response: {
    world?: WorldSummary;
    worldState?: Record<string, unknown>;
    deployment?: WorldRuntimeMetadata['deployment'];
    costEstimate?: WorldRuntimeMetadata['costEstimate'];
    run?: WorldRuntimeRun;
    latestActivityAt?: string | null;
    latestActivityKind?: string | null;
    latestActivitySummary?: string | null;
  }) => {
    if (!response.world) return;
    cacheServerWorld(response.world);
    setMetadata((current) => current ? {
      ...current,
      world: response.world as WorldSummary,
      balance: response.world?.balance ?? current.balance,
      publicState: response.worldState ?? current.publicState,
      deployment: response.deployment ?? (response.worldState?.deployment as WorldRuntimeMetadata['deployment'] | undefined) ?? current.deployment,
      costEstimate: response.costEstimate ?? (response.worldState?.costEstimate as WorldRuntimeMetadata['costEstimate'] | undefined) ?? current.costEstimate,
      latestRun: response.run ?? current.latestRun,
      latestActivityAt: response.latestActivityAt ?? current.latestActivityAt,
      latestActivityKind: response.latestActivityKind ?? current.latestActivityKind,
      latestActivitySummary: response.latestActivitySummary ?? current.latestActivitySummary,
    } : current);
    queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
      [response.world as WorldSummary, ...current.filter((item) => item.id !== response.world?.id)]
    ));
  };

  const resolveClientDataSource = async (sourceConfig: TriggerSourceConfig) => {
    const source = builder?.dataSources.find((item) => item.id === sourceConfig.sourceId);
    if (!source?.url) return { skipped: true, reason: 'No data source URL configured.' };
    const variables = { runtime: { inputs }, worldState: metadata?.publicState ?? {}, source: { config: sourceConfig } };
    const url = absoluteUrl(interpolatePlain(source.url, variables));
    const method = source.method ?? 'GET';
    const init: RequestInit = { method };
    const bodyTemplate = sourceConfig.requestBodyTemplate ?? source.requestBodyTemplate;
    if (method === 'POST' && bodyTemplate) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = interpolatePlain(bodyTemplate, variables);
    }
    try {
      const response = await fetch(url, init);
      const contentType = response.headers.get('content-type') ?? '';
      const body = contentType.includes('application/json') ? await response.json() : await response.text();
      return { ok: response.ok, status: response.status, url, method, body };
    } catch (error) {
      return { ok: false, url, method, error: error instanceof Error ? error.message : 'Browser data source request failed.' };
    }
  };

  const resolveClientSourceValue = async (trigger: WorldBuilderTrigger) => {
    const condition = objectValue(trigger.condition);
    const sourceConfig = trigger.sourceConfig ?? condition.sourceConfig as TriggerSourceConfig | undefined;
    if (!sourceConfig) return { config: sourceConfig, value: undefined, raw: undefined };
    if (sourceConfig.kind === 'builder_input') return { config: sourceConfig, value: readPath(inputs, sourceConfig.sourceId ?? sourceConfig.path), raw: inputs };
    if (sourceConfig.kind === 'runtime_state') return { config: sourceConfig, value: readPath(metadata?.publicState ?? {}, sourceConfig.path), raw: metadata?.publicState ?? {} };
    if (sourceConfig.kind === 'manual_payload') return { config: sourceConfig, value: readPath({}, sourceConfig.path), raw: {} };
    if (sourceConfig.kind === 'schedule_time') {
      const raw = { now: new Date().toISOString(), cron: trigger.typeConfig?.cronExpression ?? objectValue(condition.typeConfig).cronExpression };
      return { config: sourceConfig, value: readPath(raw, sourceConfig.path ?? 'now'), raw };
    }
    if (sourceConfig.kind === 'zone_state') {
      const zones = Array.isArray(metadata?.publicState.zones) ? metadata?.publicState.zones : builder?.zones ?? [];
      const zone = zones.find((item) => item && typeof item === 'object' && (item as { id?: string }).id === sourceConfig.sourceId);
      return { config: sourceConfig, value: readPath(zone, sourceConfig.path), raw: zone };
    }
    if (sourceConfig.kind === 'faction_state') {
      const factions = Array.isArray(metadata?.publicState.factions) ? metadata?.publicState.factions : builder?.factions ?? [];
      const faction = factions.find((item) => item && typeof item === 'object' && (item as { id?: string }).id === sourceConfig.sourceId);
      return { config: sourceConfig, value: readPath(faction, sourceConfig.path), raw: faction };
    }
    if (sourceConfig.kind === 'data_source') {
      const raw = await resolveClientDataSource(sourceConfig);
      return { config: sourceConfig, value: readPath(raw, sourceConfig.path), raw };
    }
    return { config: sourceConfig, value: undefined, raw: undefined };
  };

  const buildConditionFailedRun = (
    trigger: WorldBuilderTrigger,
    actionId: string,
    source: Awaited<ReturnType<typeof resolveClientSourceValue>>,
    evaluation: ReturnType<typeof evaluateConditionValue>,
  ): WorldRuntimeRun => {
    const timestamp = new Date().toISOString();
    const idSuffix = timestamp.replace(/[^0-9]/g, '');
    const typeConfig = trigger.typeConfig ?? objectValue(trigger.condition).typeConfig as TriggerTypeConfig | undefined;
    const operator = typeConfig?.operator ?? 'exists';
    const compareValue = typeConfig?.compareValue ?? '';
    const eventDetail = {
      decision: 'CONDITION_NOT_PASSED',
      triggerId: trigger.id,
      triggerName: trigger.name,
      triggerType: trigger.type,
      actionId,
      evaluatedAt: timestamp,
      condition: {
        enabled: typeConfig?.conditionEnabled !== false,
        operator,
        expectedValue: operator === 'exists' ? null : compareValue,
        actualValue: source.value,
        actualValueText: stringifyValue(source.value),
        sourceKind: source.config?.kind,
        sourceId: source.config?.sourceId,
        sourcePath: source.config?.path,
        rawSource: source.raw,
        reason: evaluation.reason,
      },
      workflow: {
        continued: false,
        skippedAgentCount: trigger.agentChain.length,
        skippedAgentIds: trigger.agentChain,
        outputMeaning: 'The trigger did not continue because its frontend condition check failed. No agent call, chain step, receipt, or state write was executed after this event.',
      },
    };
    const worldState: Record<string, unknown> = {
      ...(metadata?.publicState ?? {}),
      latestRunAt: timestamp,
      latestActionId: actionId,
      latestTriggerId: trigger.id,
      latestConditionPassed: false,
      latestConditionEvent: eventDetail,
    };
    for (const mapping of trigger.outputMapping ?? []) {
      if (mapping.target !== 'faction' || !mapping.path) continue;
      const factions = Array.isArray(worldState.factions) ? [...worldState.factions] : [];
      const targetIndex = factions.findIndex((faction) => faction && typeof faction === 'object' && (faction as { id?: string }).id === mapping.targetId);
      if (targetIndex < 0) continue;
      const faction = factions[targetIndex] && typeof factions[targetIndex] === 'object'
        ? { ...factions[targetIndex] as Record<string, unknown> }
        : {};
      const state = faction.state && typeof faction.state === 'object' && !Array.isArray(faction.state)
        ? { ...faction.state as Record<string, unknown> }
        : {};
      state[mapping.path] = eventDetail;
      faction.state = state;
      factions[targetIndex] = faction;
      worldState.factions = factions;
    }
    return {
      id: `condition-failed-${trigger.id}-${idSuffix}`,
      actionId,
      engine: builder?.engine ?? 'genericEventWorld',
      status: 'complete',
      inputs,
      summary: eventDetail,
      agentResponses: [],
      events: [{
        id: `condition-event-${trigger.id}-${idSuffix}`,
        type: 'trigger_fired',
        title: `${trigger.name} condition did not pass`,
        description: JSON.stringify(eventDetail, null, 2),
        timestamp,
      }],
      receipts: [],
      graph: builder?.graph ?? { nodes: [], edges: [] },
      worldState,
      createdAt: timestamp,
    };
  };

  const resolveFrontendCondition = async (trigger: WorldBuilderTrigger | undefined, actionId: string) => {
    if (!trigger || trigger.type !== 'data_condition') return null;
    const typeConfig = trigger.typeConfig ?? objectValue(trigger.condition).typeConfig as TriggerTypeConfig | undefined;
    if (typeConfig?.conditionEnabled === false) return null;
    const source = await resolveClientSourceValue(trigger);
    const evaluation = evaluateConditionValue(source.value, typeConfig);
    return evaluation.passed ? null : buildConditionFailedRun(trigger, actionId, source, evaluation);
  };

  const deployWorld = async () => {
    setRunning(true);
    setMessage('Preparing live world manifest...');
    try {
      const preview = await fetch(`/api/apps/${worldId}/deploy/manifest`).then((res) => res.json()).catch(() => ({ error: 'Unable to prepare live manifest.' }));
      if (preview.error) {
        setMessage(preview.error);
        return;
      }
      if (!preview.liveDeployable) {
        setMessage(`This world cannot be deployed live yet: ${(preview.unsupported ?? []).join(' ')}`);
        return;
      }
      setMessage('Waiting for wallet confirmation to deploy and configure the world...');
      const { sdk } = await createBrowserWorldSdk();
      const result = await sdk.deployWorldManifest({
        name: metadata?.world.name ?? preview.world?.name ?? 'REVERIE World',
        template: preview.world?.template ?? builder?.uiSlug ?? 'custom',
        builderConfig: preview.builder,
        subscribeTriggers: false,
      });
      const balanceStt = await result.world.getBalance();
      const response = await fetch(`/api/apps/${worldId}/deploy/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: result.worldAddress,
          deployTxHash: result.deployTxHash,
          configureTxHash: result.configureTxHash,
          subscriptionTxHashes: result.subscriptionTxHashes,
          manifestHash: result.manifest.manifestHash,
          manifest: result.manifest,
          balanceStt,
        }, (_key, value) => typeof value === 'bigint' ? value.toString() : value),
      }).then((res) => res.json()).catch(() => ({ error: 'Unable to record live deployment.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      applyWorldResponse(response);
      setMessage('Live deployment complete. Fund the world before subscribing triggers and arming autonomy.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Live deployment failed.');
    } finally {
      setRunning(false);
    }
  };

  const fundWorld = async () => {
    setRunning(true);
    try {
      if (!metadata?.world.contractAddress) {
        setMessage('Deploy this world before funding it.');
        return;
      }
      setMessage('Waiting for wallet confirmation to fund the world...');
      const liveWorld = await getLiveWorld(metadata.world.contractAddress);
      const verified = await liveWorld.fundAndVerify(funding);
      const response = await fetch(`/api/apps/${worldId}/fund/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountStt: funding, balanceStt: verified.balanceStt, transactionHash: verified.txHash }),
      }).then((res) => res.json()).catch(() => ({ error: 'Unable to record live funding.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      applyWorldResponse(response);
      setMessage(`Live funding confirmed for ${funding} STT. You can now subscribe triggers.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Live funding failed.');
    } finally {
      setRunning(false);
    }
  };

  const subscribeWorld = async () => {
    setRunning(true);
    try {
      if (!metadata?.world.contractAddress || !builder) {
        setMessage('Deploy this world before subscribing triggers.');
        return;
      }
      if (!hasMinimumFunding) {
        setMessage(`Fund at least ${minimumBalance} STT before subscribing triggers.`);
        return;
      }
      setMessage('Waiting for wallet confirmation to subscribe live triggers...');
      const liveWorld = await getLiveWorld(metadata.world.contractAddress);
      const manifest = await compileLiveManifest(builder);
      const result = await liveWorld.subscribeManifestTriggers(manifest);
      if (result.txHashes.length === 0) {
        setMessage('No contract-event triggers require subscription. You can arm the runtime.');
        return;
      }
      const response = await fetch(`/api/apps/${worldId}/runtime/subscribe/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionHashes: result.txHashes, subscriptions: result.subscriptions }),
      }).then((res) => res.json()).catch((error) => ({ error: error instanceof Error ? error.message : 'Trigger subscription failed.' }));
      if (response.error) {
        setMessage(response.error);
      } else {
        applyWorldResponse(response);
        if (Array.isArray(response.subscriptions)) setLiveSubscriptions(response.subscriptions);
        setMessage('Live trigger subscriptions confirmed. You can now arm autonomy.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Trigger subscription failed.');
    } finally {
      setRunning(false);
    }
  };

  const reconcileWorld = async () => {
    setRunning(true);
    try {
      setMessage('Reconciling live workflow events from Somnia RPC...');
      const response = await fetch(`/api/apps/${worldId}/runtime/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then((res) => res.json()).catch((error) => ({ error: error instanceof Error ? error.message : 'Runtime reconciliation failed.' }));
      if (response.error) {
        setMessage(response.error);
      } else {
        applyWorldResponse(response);
        setMessage(`Runtime reconciled. ${response.requestCount ?? 0} request event${response.requestCount === 1 ? '' : 's'} indexed.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Runtime reconciliation failed.');
    } finally {
      setRunning(false);
    }
  };

  const buildContractConditionFailedRun = useCallback((
    trigger: WorldBuilderTrigger,
    actionId: string,
    payload: ReturnType<typeof buildContractEventPayload>,
  ): WorldRuntimeRun => {
    const timestamp = new Date().toISOString();
    const failed = payload.evaluations.filter((evaluation) => !evaluation.passed);
    const idSuffix = timestamp.replace(/[^0-9]/g, '');
    const eventDetail = {
      decision: 'CONTRACT_EVENT_CONDITION_NOT_PASSED',
      triggerId: trigger.id,
      triggerName: trigger.name,
      triggerType: trigger.type,
      actionId,
      evaluatedAt: timestamp,
      contractEvent: {
        payload: payload.payload,
        decoded: payload.decoded,
        failedConditions: failed.map((evaluation) => ({
          datapointId: evaluation.point.id,
          alias: evaluation.point.alias,
          path: evaluation.point.path,
          actualValue: evaluation.value,
          actualValueText: stringifyContractValue(evaluation.value),
          reason: evaluation.reason,
        })),
      },
      workflow: {
        continued: false,
        skippedAgentCount: trigger.agentChain.length,
        skippedAgentIds: trigger.agentChain,
        outputMeaning: 'The on-chain event was received, but one or more selected datapoint conditions failed. The workflow did not call agents or write state after this event.',
      },
    };
    const worldState: Record<string, unknown> = {
      ...(metadata?.publicState ?? {}),
      latestRunAt: timestamp,
      latestActionId: actionId,
      latestTriggerId: trigger.id,
      latestConditionPassed: false,
      latestConditionEvent: eventDetail,
    };
    return {
      id: `contract-condition-failed-${trigger.id}-${idSuffix}`,
      actionId,
      engine: builder?.engine ?? 'genericEventWorld',
      status: 'complete',
      inputs,
      summary: eventDetail,
      agentResponses: [],
      events: [{
        id: `contract-condition-event-${trigger.id}-${idSuffix}`,
        type: 'trigger_fired',
        title: `${trigger.name} contract event condition did not pass`,
        description: JSON.stringify(eventDetail, null, 2),
        timestamp,
      }],
      receipts: [],
      graph: builder?.graph ?? { nodes: [], edges: [] },
      worldState,
      createdAt: timestamp,
    };
  }, [builder?.engine, builder?.graph, inputs, metadata?.publicState]);

  const executeContractTrigger = useCallback(async (
    trigger: WorldBuilderTrigger,
    log: ContractLogLike,
  ) => {
    const config = contractEventConfigFor(trigger);
    if (!config) return;
    const logKey = contractLogKey(trigger.id, log);
    if (seenContractLogsRef.current.has(logKey)) return;
    seenContractLogsRef.current.add(logKey);
    const payload = buildContractEventPayload(config, log);
    const actionId = `contract-event-${trigger.id}-${log.transactionHash ?? Date.now()}-${log.logIndex ?? 0}`;
    if (!payload.passed) {
      const conditionFailedRun = buildContractConditionFailedRun(trigger, actionId, payload);
      setRun(conditionFailedRun);
      setMetadata((current) => current ? { ...current, publicState: conditionFailedRun.worldState, latestRun: conditionFailedRun } : current);
      setMessage('Contract event received, but datapoint conditions did not pass.');
      return;
    }
    setMessage(`Contract event matched ${trigger.name}. The on-chain REVERIE subscription owns workflow execution; refresh live state after finalization.`);
  }, [buildContractConditionFailedRun]);

  useEffect(() => {
    if (!canListenContractEvents) return;

    const sockets: WebSocket[] = [];
    let closed = false;
    const wsUrl = somniaWsUrl();

    for (const trigger of activeContractTriggers) {
      const config = contractEventConfigFor(trigger);
      if (!config?.emitterAddress) continue;
      const socket = new WebSocket(wsUrl);
      sockets.push(socket);
      socket.onopen = () => {
        const topics = contractTopicFilter(config);
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          id: trigger.id,
          method: 'eth_subscribe',
          params: ['logs', {
            address: config.emitterAddress,
            topics,
          }],
        }));
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as {
          id?: string;
          result?: unknown;
          method?: string;
          params?: { result?: Record<string, unknown> };
          error?: { message?: string };
        };
        if (message.error?.message) {
          setReactivityStatus(`Contract listener error: ${message.error.message}`);
          return;
        }
        if (message.result && message.id === trigger.id) {
          setReactivityStatus(`Listening for ${activeContractTriggers.length} contract-event trigger${activeContractTriggers.length === 1 ? '' : 's'}.`);
          return;
        }
        const rawLog = message.method === 'eth_subscription' ? message.params?.result : null;
        if (!rawLog || closed) return;
        void executeContractTrigger(trigger, {
          address: typeof rawLog.address === 'string' ? rawLog.address : config.emitterAddress,
          blockNumber: hexToNumber(rawLog.blockNumber),
          transactionHash: typeof rawLog.transactionHash === 'string' ? rawLog.transactionHash : '',
          logIndex: hexToNumber(rawLog.logIndex),
          topics: Array.isArray(rawLog.topics) ? rawLog.topics.filter((topic): topic is string => typeof topic === 'string') : [],
          data: typeof rawLog.data === 'string' ? rawLog.data : '0x',
        });
      };
      socket.onerror = () => {
        setReactivityStatus(`Unable to listen for ${trigger.name}. Check the Somnia WSS endpoint.`);
      };
      socket.onclose = () => {
        if (!closed) setReactivityStatus('Contract event listener disconnected.');
      };
    }

    return () => {
      closed = true;
      for (const socket of sockets) socket.close();
    };
  }, [activeContractTriggers, canListenContractEvents, executeContractTrigger]);

  const executeAction = async (actionId: string) => {
    setRunning(true);
    const revokeCapabilityIds: string[] = [];
    try {
      setMessage('Running manual trigger...');
      const action = (builder?.manualActions ?? []).find((item) => item.id === actionId);
      const actionTrigger = action?.triggerId ? (builder?.triggers ?? []).find((trigger) => trigger.id === action.triggerId) : undefined;
      const conditionFailedRun = await resolveFrontendCondition(actionTrigger, actionId);
      if (conditionFailedRun) {
        setRun(conditionFailedRun);
        setMetadata((current) => current ? { ...current, publicState: conditionFailedRun.worldState, latestRun: conditionFailedRun } : current);
        setMessage('Condition did not pass. Runtime API was not called and the workflow stopped at the condition event.');
        return;
      }
      if (!metadata?.world.contractAddress) {
        setMessage('Deploy this world before firing live manual triggers.');
        return;
      }
      if (!hasMinimumFunding) {
        setMessage(`Fund at least ${minimumBalance} STT before firing live workflows.`);
        return;
      }
      if (!actionTrigger) {
        setMessage('This action is not connected to a live trigger.');
        return;
      }
      if (!builder) {
        setMessage('Builder configuration is still loading. Try again in a moment.');
        return;
      }
      setMessage('Waiting for wallet confirmation to fire live manual trigger...');
      const liveWorld = await getLiveWorld(metadata.world.contractAddress);
      const triggerId = compiledTriggerId(builder, actionTrigger);
      const chainSteps = (actionTrigger.agentChain ?? [])
        .map((stepId) => builder.agentChain.find((step) => step.id === stepId || step.agentId === stepId || step.toolId === stepId))
        .filter((step): step is NonNullable<typeof step> => Boolean(step));
      const toolSteps = chainSteps.filter((step) => step.stepType === 'tool' && step.toolId);
      const verified = toolSteps.length > 0
        ? await (async () => {
            setMessage('Creating one-shot MCP capability for this manual tool run...');
            const capability = await fetch('/api/tools/mcp-capabilities', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                worldId,
                triggerId,
                toolIds: [...new Set(toolSteps.map((step) => step.toolId).filter(Boolean))],
                name: `${metadata.world.name} manual tool run`,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              }),
            }).then((res) => res.json()).catch((error) => ({ error: error instanceof Error ? error.message : 'Unable to create MCP capability.' }));
            if (capability.error || !capability.mcpServerUrl) throw new Error(capability.error ?? 'MCP capability URL was not returned.');
            revokeCapabilityIds.push(capability.capabilityId);
            const toolInstructions = toolSteps.map((step) => `${step.name}: call tool "${step.toolSlug ?? step.toolId}" with JSON input ${step.toolInputTemplate || '{"input":"{{previous.output}}"}'}`).join('\n');
            return liveWorld.requestLlmToolsChatAndParse({
              triggerId,
              roles: ['system', 'user'],
              messages: [
                'You are the live REVERIE world tool orchestrator. Call the provided MCP tools when the workflow asks for them. Return the final tool response and any previous agent context as concise JSON.',
                [
                  `Manual action: ${action?.label ?? actionId}`,
                  `Runtime inputs: ${JSON.stringify(inputs ?? {})}`,
                  `Trigger payload: ${JSON.stringify(action?.inputOverrides ?? {})}`,
                  `Tool instructions:\n${toolInstructions}`,
                ].join('\n\n'),
              ],
              mcpServerUrls: [capability.mcpServerUrl],
            });
          })()
        : await liveWorld.fireManualTriggerAndParse({ triggerId, context: action?.label ?? actionId });
      const response = await fetch(`/api/apps/${worldId}/runtime/manual-trigger/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerId, actionId, inputs, transactionHash: verified.txHash, mcpCapabilityIds: revokeCapabilityIds }),
      }).then((res) => res.json()).catch((error) => ({ error: error instanceof Error ? error.message : 'Live manual trigger failed.' }));
      if (response.error) {
        setMessage(response.error);
      } else {
        setRun(response.run);
        applyWorldResponse(response);
        const live = await fetch(`/api/apps/${worldId}/runtime/live`).then((res) => res.json()).catch(() => ({}));
        if (Array.isArray(live.requests)) setLiveRequests(live.requests);
        if (Array.isArray(live.subscriptions)) setLiveSubscriptions(live.subscriptions);
        setMessage(response.run?.summary?.requestIds?.length ? 'Live manual trigger submitted and agent requests are pending receipts.' : 'Live manual trigger submitted. Reconcile runtime after callbacks finalize.');
        window.setTimeout(() => void reconcileWorld(), 12_000);
        window.setTimeout(() => void reconcileWorld(), 45_000);
      }
    } catch (error) {
      for (const capabilityId of revokeCapabilityIds) {
        void fetch(`/api/tools/mcp-capabilities/${capabilityId}/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'manual_tool_run_error' }),
        });
      }
      setMessage(error instanceof Error ? error.message : 'Live manual trigger failed.');
    } finally {
      setRunning(false);
    }
  };

  const startWorld = async () => {
    setRunning(true);
    try {
      setMessage('Preparing the latest published manifest before arming...');
      if (!metadata?.world.contractAddress) {
        setMessage('Deploy this world before arming it.');
        return;
      }
      if (!hasMinimumFunding) {
        setMessage(`Fund at least ${minimumBalance} STT before arming autonomy.`);
        return;
      }
      if (!runtimeSubscribed) {
        setMessage('Subscribe contract-event triggers before arming autonomy.');
        return;
      }
      setMessage('Applying the latest published manifest before arming...');
      const preview = await fetch(`/api/apps/${worldId}/deploy/manifest`).then((res) => res.json()).catch(() => ({ error: 'Unable to prepare live manifest.' }));
      if (preview.error) {
        setMessage(preview.error);
        return;
      }
      if (!preview.liveDeployable) {
        setMessage(`This world cannot be armed live yet: ${(preview.unsupported ?? []).join(' ')}`);
        return;
      }
      const result = await applyArmAndMaybeStartWorld({
        worldId,
        world: metadata.world,
        builder: preview.builder,
        inputs,
        publicState: metadata.publicState,
        onMessage: setMessage,
      });
      const response = result.startResponse ?? result.armResponse;
      applyWorldResponse(response);
      if (response.run) setRun(response.run as WorldRuntimeRun);
      setMessage(result.startResponse
        ? 'Runtime armed and the non-manual starting trigger was fired on-chain.'
        : 'Runtime armed on-chain. Manual starting triggers run only when you click them.');
      if (result.startResponse) {
        window.setTimeout(() => void reconcileWorld(), 12_000);
        window.setTimeout(() => void reconcileWorld(), 45_000);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'World arm failed.');
    } finally {
      setRunning(false);
    }
  };

  const stopWorld = async () => {
    setRunning(true);
    try {
      setMessage('Waiting for wallet confirmation to stop live runtime...');
      if (!metadata?.world.contractAddress) {
        setMessage('Deploy this world before stopping it.');
        return;
      }
      const reason = 'Stopped manually by owner.';
      const liveWorld = await getLiveWorld(metadata.world.contractAddress);
      const txHash = await liveWorld.stopWorld(reason);
      await liveWorld.waitForTransaction(txHash);
      const response = await fetch(`/api/apps/${worldId}/runtime/stop/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, transactionHash: txHash }),
      }).then((res) => res.json()).catch((error) => ({ error: error instanceof Error ? error.message : 'World stop failed.' }));
      if (response.error) {
        setMessage(response.error);
      } else {
        applyWorldResponse(response);
        setMessage(`World stopped. ${response.stopReason ?? ''}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'World stop failed.');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto w-full glass-panel p-6 flex items-center gap-3 text-text-muted">
        <div className="w-5 h-5 border-2 border-dream/30 border-t-dream rounded-full animate-spin" />
        Loading runtime...
      </div>
    );
  }

  if (!metadata || !builder || builder.uiSlug !== worldSlug) {
    return (
      <div className="max-w-3xl mx-auto w-full glass-panel p-8">
        <h1 className="text-3xl font-display font-bold mb-2">Runtime Not Published</h1>
        <p className="text-text-muted mb-6">No builder runtime is available for slug <span className="font-mono text-dream">{worldSlug}</span>.</p>
        <Link href={worldUrl(linkWorld, '/builder')} className="px-4 py-2 bg-teal text-void rounded-lg font-semibold inline-flex">
          Open World Builder
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      <Link href={worldUrl(linkWorld)} className="inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
        <ArrowLeft className="w-4 h-4" /> Back to world
      </Link>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold mb-1">{builder.displayName}</h1>
          <p className="text-text-muted">{builder.description}</p>
          <p className="text-xs text-text-muted font-mono mt-2">Engine: {builder.engine ?? 'genericEventWorld'} / Runtime: {builder.uiSlug}</p>
        </div>
        {metadata.capabilities.canEdit && (
          <Link href={worldUrl(linkWorld, '/builder')} className="px-4 py-2 border border-dream/30 rounded-lg text-sm flex items-center gap-2">
            Edit Builder <ExternalLink className="w-4 h-4" />
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-2">World Balance</p>
          <p className="text-2xl font-display font-bold">{metadata.balance}</p>
        </div>
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-2">Status</p>
          <p className="text-2xl font-display font-bold capitalize">{metadata.world.status}</p>
          <p className="text-xs text-text-muted mt-1">Runtime: {displayRuntimeStatus}</p>
        </div>
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-2">Triggers</p>
          <p className="text-2xl font-display font-bold">{metadata.triggers.length}</p>
        </div>
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-2">Last Activity</p>
          <p className="text-sm font-mono text-text-muted break-words">{latestActivityAt ?? 'None yet'}</p>
          {latestActivityAt && <p className="mt-1 text-xs text-text-muted line-clamp-2 break-words">{latestActivityLabel}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-2">Deployment</p>
          <p className="text-lg font-display font-bold capitalize">{metadata.deployment?.mode ?? 'not deployed'}</p>
          {metadata.deployment?.contractAddress || metadata.world.contractAddress ? (
            <a
              href={evmAddressUrl(metadata.deployment?.contractAddress || metadata.world.contractAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 text-xs font-mono text-teal hover:text-aurora break-all"
            >
              View contract <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <p className="mt-2 text-xs font-mono text-text-muted break-all">Deploy from settings to create the live world contract.</p>
          )}
        </div>
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-2">Callback Receiver</p>
          <p className="text-xs font-mono text-text-muted break-all">{metadata.deployment?.callbackReceiverAddress ?? 'Not deployed'}</p>
        </div>
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-2">Minimum Run Cost</p>
          <p className="text-lg font-display font-bold">{metadata.costEstimate?.minimumBalanceStt ?? 0} STT</p>
          <p className="text-xs text-text-muted mt-1">Recommended: {metadata.costEstimate?.recommendedBalanceStt ?? 0} STT</p>
        </div>
      </div>

      {metadata.capabilities.canRunManualActions && (
        <section className="glass-panel p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-sm text-text-muted">Live world controls</p>
              <p className="text-xl font-display font-bold capitalize">{metadata.world.status}</p>
              <p className="text-xs text-text-muted mt-1">Runtime state: <span className="font-mono text-dream">{displayRuntimeStatus}</span></p>
              <p className="text-xs text-text-muted font-mono mt-1 break-all">{metadata.world.contractAddress || 'Not deployed yet'}</p>
              {!hasStartTrigger && <p className="mt-2 text-xs text-red-300">Publish a starting trigger before preparing or arming the live manifest.</p>}
              {hasAutonomousTriggers && !runtimeSubscribed && (
                <p className="mt-2 text-xs text-yellow-200">Subscribe all active scheduled or contract-event triggers before applying and arming this runtime. Confirmed: {recordedActiveSubscriptions}/{requiredAutonomousTriggers.length}.</p>
              )}
              {!hasMinimumFunding && metadata.world.status !== 'draft' && (
                <p className="mt-2 text-xs text-yellow-200">Fund at least {minimumBalance} STT before subscribing, applying, or firing live workflows.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {metadata.world.status === 'draft' && (
                <button onClick={deployWorld} disabled={running || !canDeployWorld} className="px-4 py-2 bg-dream text-void rounded-lg flex items-center gap-2 font-semibold disabled:opacity-60">
                  {running ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Rocket className="w-4 h-4" />}
                  Deploy Live World
                </button>
              )}
              {metadata.world.status !== 'draft' && (
                <div className="flex rounded-lg overflow-hidden border border-teal/30">
                  <input value={funding} onChange={(event) => setFunding(event.target.value)} className="w-24 bg-void px-3 py-2 text-sm outline-none" />
                  <button onClick={fundWorld} disabled={running || !canFundWorld} className="px-3 py-2 bg-teal text-void font-semibold inline-flex items-center gap-2 disabled:opacity-60">
                    {running ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Wallet className="w-4 h-4" />}
                    Fund
                  </button>
                </div>
              )}
              {metadata.world.status !== 'draft' && hasAutonomousTriggers && (
                <button onClick={subscribeWorld} disabled={running || !canSubscribeWorld} className="px-4 py-2 border border-teal/30 rounded-lg flex items-center gap-2 disabled:opacity-60">
                  {running ? <div className="w-4 h-4 border-2 border-teal/30 border-t-teal rounded-full animate-spin" /> : <Zap className="w-4 h-4" />}
                  Subscribe Triggers
                </button>
              )}
              {metadata.world.status !== 'draft' && metadata.world.status !== 'running' && runtimeStatus !== 'armed' && (
                <button onClick={startWorld} disabled={running || !canStartWorld} className="px-4 py-2 bg-teal text-void rounded-lg flex items-center gap-2 font-semibold disabled:opacity-60">
                  {running ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
                  Apply & Arm Runtime
                </button>
              )}
              {metadata.world.status === 'running' && (
                <button onClick={stopWorld} disabled={running} className="px-4 py-2 border border-dream/30 rounded-lg flex items-center gap-2 disabled:opacity-60">
                  {running ? <div className="w-4 h-4 border-2 border-dream/30 border-t-dream rounded-full animate-spin" /> : <Square className="w-4 h-4" />}
                  Stop World
                </button>
              )}
              {metadata.world.status !== 'draft' && (
                <button onClick={reconcileWorld} disabled={running || !metadata.world.contractAddress} className="px-4 py-2 border border-dream/30 rounded-lg flex items-center gap-2 disabled:opacity-60">
                  {running ? <div className="w-4 h-4 border-2 border-dream/30 border-t-dream rounded-full animate-spin" /> : <ReceiptText className="w-4 h-4" />}
                  Reconcile
                </button>
              )}
            </div>
          </div>
          {!canDeployWorld && metadata.world.status === 'draft' && (
            <p className="text-xs text-text-muted">Publish the builder before deploying this live world.</p>
          )}
          {metadata.world.status !== 'draft' && !hasMinimumFunding && (
            <p className="text-xs text-text-muted">Fund at least {minimumBalance} STT before subscribing triggers, arming, or firing autonomous workflows.</p>
          )}
        </section>
      )}

      <div className="glass-panel p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Contract Event Reactivity</p>
          <p className="text-xs text-text-muted">On-chain Reactivity owns autonomous trigger execution. This page only mirrors live logs and lets the owner fire manual triggers.</p>
        </div>
        <p className="text-xs font-mono text-teal md:text-right">{displayedReactivityStatus}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
        <section className="glass-panel p-6 space-y-4">
          <h2 className="text-lg font-display font-semibold flex items-center gap-2"><Play className="w-5 h-5 text-teal" /> Runtime Inputs</h2>
          {builder.inputSchema.length === 0 && <p className="text-sm text-text-muted">No runtime inputs configured.</p>}
          {builder.inputSchema.map((input) => (
            <label key={input.id} className="block">
              <span className="text-sm text-text-muted">{input.label}</span>
              {input.type === 'select' ? (
                <select value={inputs[input.id] ?? ''} onChange={(event) => setInputs((current) => ({ ...current, [input.id]: event.target.value }))} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3">
                  {(input.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  {(!input.options || input.options.length === 0) && <option value={inputDefault(input)}>{inputDefault(input)}</option>}
                </select>
              ) : (
                <input type={input.type === 'number' ? 'number' : 'text'} value={inputs[input.id] ?? ''} onChange={(event) => setInputs((current) => ({ ...current, [input.id]: event.target.value }))} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3" />
              )}
            </label>
          ))}

          <div className="border-t border-dream/10 pt-4 space-y-3">
            <h3 className="font-medium flex items-center gap-2"><Zap className="w-4 h-4 text-dream" /> Manual Actions</h3>
            {visibleActions.length === 0 && <p className="text-sm text-text-muted">No manual actions configured.</p>}
            {visibleActions.map((action) => (
              <button
                key={action.id}
                onClick={() => executeAction(action.id)}
                disabled={running}
                className="w-full py-3 bg-teal text-void rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {running ? 'Running...' : action.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-text-muted">{message}</p>
        </section>

        <section className="glass-panel p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-display font-semibold flex items-center gap-2"><GitBranch className="w-5 h-5 text-dream" /> World Graph</h2>
            <Link href={worldUrl(linkWorld, '/triggers')} className="text-sm text-teal hover:text-aurora">Manage Triggers</Link>
          </div>
          <div className="space-y-4">
            {graphGroups.map((group) => (
              <div key={group.type}>
                <p className="mb-2 text-xs uppercase tracking-wider text-text-muted">{group.label}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {group.nodes.map((node) => (
                    <Link
                      key={graphNodeIdentity(node)}
                      href={node.type === 'trigger' && node.refId ? `${worldUrl(linkWorld, '/triggers')}?triggerId=${node.refId}` : '#'}
                      title={node.refId ?? node.id}
                      className={`relative rounded-lg border p-4 ${node.type === 'trigger' ? 'border-teal/25 bg-teal/10 hover:bg-teal/15' : 'border-dream/15 bg-void/50'}`}
                    >
                      <p className="text-xs uppercase tracking-wider text-text-muted">{node.type}</p>
                      <p className="font-medium break-words">{twoWordLabel(node.label)}</p>
                      {node.refId && <p className="text-xs text-text-muted font-mono mt-1 truncate">{twoWordLabel(node.refId)}</p>}
                      {node.count > 1 && <span className="absolute right-2 top-2 rounded-full border border-dream/20 bg-dream/10 px-2 py-0.5 text-[10px] text-dream">x{node.count}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {graph.nodes.length === 0 && <p className="text-sm text-text-muted">No graph nodes configured.</p>}
          </div>
          {graph.edges.length > 0 && (
            <div className="mt-5 rounded-lg border border-dream/10 bg-void/50 p-4">
              <p className="mb-2 text-sm font-medium">Relationships</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-2 text-xs font-mono text-text-muted">
                {graph.edges.map((edge) => {
                  const labels = relationshipLabels.get(edge.id);
                  return <p key={edge.id} className="min-w-0 break-words" title={`${edge.source} -> ${edge.target}${edge.label ? ` / ${edge.label}` : ''}`}>{labels?.source ?? edge.source} {'->'} {labels?.target ?? edge.target}{labels?.label ? ` / ${labels.label}` : ''}</p>;
                })}
              </div>
            </div>
          )}
        </section>
      </div>

      {(run || liveAgentResponses.length > 0) && (
        <>
          {run && <section className="glass-panel p-6">
            <h2 className="text-lg font-display font-semibold mb-4">Runtime Summary</h2>
            <pre className="bg-void border border-dream/10 rounded-lg p-4 text-xs whitespace-pre-wrap break-words text-text-muted">{JSON.stringify(run.summary, null, 2)}</pre>
          </section>}

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="glass-panel p-6">
              <h2 className="text-lg font-display font-semibold mb-4">Agent Responses</h2>
              <div className="space-y-3">
                {(liveAgentResponses.length > 0 ? liveAgentResponses : run?.agentResponses ?? []).map((agent) => (
                  <div key={agent.id} className="rounded-lg border border-dream/10 bg-void/50 p-4">
                    {(() => {
                      const requestId = receiptRequestId(agent.receiptUrl) || String(readPath(agent.response, 'requestId') ?? '');
                      const liveRequest = liveRequests.find((row) => String(row.request_id ?? row.requestId ?? '') === requestId);
                      const result = objectValue(liveRequest?.result);
                      const receiptDetails = objectValue(result.receiptDetails);
                      const liveStatus = String(receiptDetails.status ?? liveRequest?.status ?? liveRequest?.callback_status ?? agent.status);
                      const errorMessage = String(receiptDetails.errorMessage ?? '');
                      const output = conciseAgentOutput(agent.response, result, receiptDetails, liveStatus);
                      return (
                        <>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium break-words">{agent.name}</p>
                        <p className="text-xs text-text-muted font-mono mb-3 break-all">{agent.agentType}</p>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs capitalize ${statusTone(liveStatus)}`}>{liveStatus}</span>
                      </div>
                      {agent.receiptUrl && (
                        <a href={agent.receiptUrl} target="_blank" rel="noopener noreferrer" className={`shrink-0 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:text-aurora ${statusTone(liveStatus)}`}>
                          Agent receipt <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                    {errorMessage && (
                      <p className="mt-3 rounded border border-red-400/20 bg-red-400/10 p-2 text-xs text-red-100 break-words">{errorMessage}</p>
                    )}
                    <div className="mt-3 rounded border border-dream/10 bg-surface/70 p-3 text-sm text-text-primary whitespace-pre-wrap break-words">
                      {output}
                    </div>
                    {'triggerId' in agent && agent.triggerId && (
                      <p className="mt-3 text-xs text-text-muted font-mono break-all">Trigger {agent.triggerId}{'stepIndex' in agent && agent.stepIndex !== undefined ? ` / Step ${agent.stepIndex}` : ''}</p>
                    )}
                    <details className="mt-3 rounded border border-dream/10 bg-void/50 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-text-muted">Raw response details</summary>
                      <pre className="mt-2 max-h-64 overflow-auto text-xs text-text-muted whitespace-pre-wrap break-words">{JSON.stringify(agent.response, null, 2)}</pre>
                    </details>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel p-6">
              <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2"><ReceiptText className="w-5 h-5 text-teal" /> Events & Receipts</h2>
              <div className="space-y-3">
                {(liveTimeline.length > 0 ? liveTimeline.slice(0, 12) : (run?.events ?? []).map((event) => ({
                  id: event.id,
                  title: event.title,
                  summary: event.description,
                  createdAt: event.timestamp,
                  status: 'success',
                  severity: 'success' as const,
                  kind: event.type,
                  worldId,
                  receiptUrl: event.receiptId ? `https://agents.testnet.somnia.network/receipts/${event.receiptId}` : undefined,
                }))).map((event) => (
                  <div key={event.id} className="rounded-lg border border-dream/10 bg-void/50 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <p className="font-medium break-words">{event.title}</p>
                      <span className={`w-fit rounded-full border px-2 py-0.5 text-xs capitalize ${statusTone(event.status)}`}>{event.status}</span>
                    </div>
                    <p className="mt-2 text-sm text-text-muted break-words">{event.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <span className="text-text-muted font-mono break-all">{event.createdAt}</span>
                      {'transactionUrl' in event && event.transactionUrl && (
                        <a href={event.transactionUrl} target="_blank" rel="noopener noreferrer" className="text-dream hover:text-teal inline-flex items-center gap-1">
                          Transaction <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {'receiptUrl' in event && event.receiptUrl && (
                        <a href={event.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-teal hover:text-aurora inline-flex items-center gap-1">
                          Receipt <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    {'details' in event && event.details && (
                      <details className="mt-3 rounded border border-dream/10 bg-void/70 p-3">
                        <summary className="cursor-pointer text-xs font-medium text-text-muted">Details</summary>
                        <pre className="mt-2 max-h-56 overflow-auto text-xs text-text-muted whitespace-pre-wrap break-words">{JSON.stringify(event.details, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                ))}
                {liveTimeline.length === 0 && (run?.events ?? []).length === 0 && (
                  <p className="text-sm text-text-muted">No live workflow events have been indexed yet. Use Reconcile after callbacks finalize.</p>
                )}
              </div>
            </div>
          </section>

          <section className="glass-panel p-6">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2"><Braces className="w-5 h-5 text-dream" /> Current World State</h2>
            <p className="text-sm text-text-muted">Open the structured state view for lifecycle, balances, zones, factions, subscriptions, runs, requests, and decoded receipt errors.</p>
            <Link href={worldUrl(linkWorld, '/state')} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-dream px-4 py-2 text-sm font-semibold text-void hover:bg-aurora">
              View World State <ExternalLink className="w-4 h-4" />
            </Link>
            <details className="mt-4 rounded-lg border border-dream/10 bg-void/50 p-4">
              <summary className="cursor-pointer text-sm font-medium text-text-muted">Advanced raw state JSON</summary>
              <pre className="mt-3 max-h-80 overflow-auto rounded border border-dream/10 bg-void p-3 text-xs text-text-muted whitespace-pre-wrap break-words">{JSON.stringify(run?.worldState ?? metadata.publicState, null, 2)}</pre>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
