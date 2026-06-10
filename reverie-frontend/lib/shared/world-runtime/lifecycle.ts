import type {
  AgentType,
  RuntimeCostEstimate,
  WorldDeploymentRecord,
  WorldBuilderConfig,
  WorldBuilderTrigger,
} from '@/lib/shared/types';

const COSTS = {
  baseTrigger: 0.02,
  dataSource: 0.01,
  toolCall: 0.015,
  receipt: 0.005,
  scheduledTick: 0.05,
  reactivitySubscription: 0.08,
  graphRelationship: 0.005,
  agent: {
    native_llm: 0.24,
    native_json_api: 0.12,
    native_web_parse: 0.33,
    reverie_custom: 0.24,
  } satisfies Record<AgentType, number>,
};

function roundStt(value: number) {
  return Math.ceil(value * 1000) / 1000;
}

function hashChunk(input: string, seed: number) {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hexFrom(input: string, length: number) {
  let output = '';
  let seed = 2166136261;
  while (output.length < length) {
    output += hashChunk(`${input}:${output.length}`, seed);
    seed = Math.imul(seed ^ output.length, 16777619);
  }
  return output.slice(0, length);
}

export function fallbackAddressFor(worldId: string, purpose = 'world') {
  return `0x${hexFrom(`reverie:${purpose}:${worldId}`, 40)}`;
}

export function fallbackTransactionHashFor(worldId: string, purpose: string, nonce = '') {
  return `0x${hexFrom(`reverie:tx:${purpose}:${worldId}:${nonce}`, 64)}`;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function envNumber(key: string, fallback: number) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function deploymentFromState(value: unknown): WorldDeploymentRecord | null {
  const record = objectValue(value);
  const deployment = objectValue(record.deployment);
  if (typeof deployment.contractAddress !== 'string') return null;
  return {
    mode: deployment.mode === 'live' ? 'live' : 'fallback',
    contractAddress: deployment.contractAddress,
    callbackReceiverAddress: typeof deployment.callbackReceiverAddress === 'string'
      ? deployment.callbackReceiverAddress
      : deployment.contractAddress,
    defaultEmitterAddress: typeof deployment.defaultEmitterAddress === 'string'
      ? deployment.defaultEmitterAddress
      : deployment.contractAddress,
    worldWalletAddress: typeof deployment.worldWalletAddress === 'string'
      ? deployment.worldWalletAddress
      : deployment.contractAddress,
    transactionHash: typeof deployment.transactionHash === 'string'
      ? deployment.transactionHash
      : fallbackTransactionHashFor(deployment.contractAddress, 'deploy'),
    deployedAt: typeof deployment.deployedAt === 'string'
      ? deployment.deployedAt
      : new Date().toISOString(),
  };
}

export function createFallbackDeployment(worldId: string, deployedAt = new Date().toISOString()): WorldDeploymentRecord {
  const contractAddress = fallbackAddressFor(worldId, 'contract');
  return {
    mode: 'fallback',
    contractAddress,
    callbackReceiverAddress: contractAddress,
    defaultEmitterAddress: contractAddress,
    worldWalletAddress: fallbackAddressFor(worldId, 'wallet'),
    transactionHash: fallbackTransactionHashFor(worldId, 'deploy'),
    deployedAt,
  };
}


function triggerIsActive(trigger: WorldBuilderTrigger) {
  return trigger.isActive !== false;
}

function startTrigger(trigger: WorldBuilderTrigger) {
  return Boolean(objectValue(trigger.condition).isStartTrigger);
}

function selectedTriggers(builder: WorldBuilderConfig, triggerIds?: string[]) {
  const triggers = builder.triggers ?? [];
  if (triggerIds?.length) {
    const selected = new Set(triggerIds);
    return triggers.filter((trigger) => selected.has(trigger.id));
  }
  const startTriggers = triggers.filter((trigger) => triggerIsActive(trigger) && startTrigger(trigger));
  if (startTriggers.length > 0) return startTriggers;
  return triggers.filter(triggerIsActive);
}

function agentTypeFor(builder: WorldBuilderConfig, agentId: string): AgentType {
  const agent = (builder.agentChain ?? []).find((step) => step.id === agentId || step.agentId === agentId || step.toolId === agentId);
  if (agent?.stepType === 'tool') return 'reverie_custom';
  return agent?.agentType ?? 'native_llm';
}

function costLine(label: string, count: number, unitCostStt: number) {
  return { label, count, unitCostStt, totalCostStt: roundStt(count * unitCostStt) };
}

function relationshipKey(sourceType: string, sourceId: string, targetType: string, targetId: string, label = '') {
  return [sourceType, sourceId, targetType, targetId, label].join(':');
}

function graphNodeType(value: string) {
  return value.includes(':') ? value.slice(0, value.indexOf(':')) : 'unknown';
}

function graphNodeRef(value: string) {
  return value.includes(':') ? value.slice(value.indexOf(':') + 1) : value;
}

function uniqueRelationshipCount(builder: WorldBuilderConfig, triggers: WorldBuilderTrigger[]) {
  const relationships = new Set<string>();
  for (const edge of builder.graph?.edges ?? []) {
    if (!edge.source || !edge.target) continue;
    relationships.add(relationshipKey(
      graphNodeType(edge.source),
      graphNodeRef(edge.source),
      graphNodeType(edge.target),
      graphNodeRef(edge.target),
      edge.label ?? 'relationship',
    ));
  }
  for (const zone of builder.zones ?? []) {
    if (zone.allocationPercent === undefined) continue;
    relationships.add(relationshipKey('zone', zone.id, 'world', 'world', 'zone_allocation'));
  }
  for (const faction of builder.factions ?? []) {
    if (faction.allocationPercent === undefined) continue;
    relationships.add(relationshipKey('faction', faction.id, 'world', 'world', 'faction_allocation'));
  }
  for (const trigger of triggers) {
    for (const mapping of trigger.outputMapping ?? []) {
      if (mapping.target === 'event') continue;
      const targetId = mapping.targetId ?? (mapping.target === 'world_state' ? 'world' : '');
      if (!targetId) continue;
      relationships.add(relationshipKey('trigger', trigger.id, mapping.target, targetId, mapping.path ?? 'output'));
    }
  }
  return relationships.size;
}

export function estimateRuntimeCost(builder: WorldBuilderConfig, options: { triggerIds?: string[] } = {}): RuntimeCostEstimate {
  const triggers = selectedTriggers(builder, options.triggerIds);
  const triggerCount = Math.max(1, triggers.length);
  const dataSourceTriggerCount = triggers.filter((trigger) => trigger.sourceConfig?.kind === 'data_source').length;
  const toolCallCount = triggers.filter((trigger) => {
    const source = trigger.sourceConfig?.sourceId
      ? builder.dataSources.find((item) => item.id === trigger.sourceConfig?.sourceId)
      : null;
    return Boolean(source?.url?.includes('/run/'));
  }).length + triggers.flatMap((trigger) => trigger.agentChain ?? []).filter((stepId) => {
    const step = builder.agentChain.find((item) => item.id === stepId || item.toolId === stepId);
    return step?.stepType === 'tool';
  }).length;
  const scheduledTickCount = triggers.filter((trigger) => trigger.type === 'scheduled').length;
  const subscriptionCount = triggers.filter((trigger) => trigger.type === 'contract_event' || trigger.type === 'scheduled').length;
  const graphWeightCount = uniqueRelationshipCount(builder, triggers);
  const chainIds = triggers.flatMap((trigger) => trigger.agentChain ?? []);
  const agentTypeCounts = chainIds.reduce<Record<AgentType, number>>((counts, agentId) => {
    const type = agentTypeFor(builder, agentId);
    counts[type] += 1;
    return counts;
  }, {
    native_llm: 0,
    native_json_api: 0,
    native_web_parse: 0,
    reverie_custom: 0,
  });
  const agentStepCount = chainIds.length;
  const receiptCount = agentStepCount;
  const agentBufferPct = envNumber('NEXT_PUBLIC_REVERIE_AGENT_FUND_BUFFER_PCT', 100);
  const reactivityBufferPct = envNumber('NEXT_PUBLIC_REVERIE_REACTIVITY_BUFFER_PCT', 20);
  const minimumWorldBalanceStt = envNumber('NEXT_PUBLIC_REVERIE_MIN_WORLD_BALANCE_STT', 0.15);
  const breakdown = [
    costLine('Base trigger execution', triggerCount, COSTS.baseTrigger),
    costLine('Builder data source calls', dataSourceTriggerCount, COSTS.dataSource),
    costLine('Deployed tool calls', toolCallCount, COSTS.toolCall),
    costLine('Scheduled reactivity overhead', scheduledTickCount, COSTS.scheduledTick),
    costLine('On-chain reactivity subscriptions', subscriptionCount, COSTS.reactivitySubscription),
    costLine('Graph allocation relationships', graphWeightCount, COSTS.graphRelationship),
    costLine('Native LLM agent steps', agentTypeCounts.native_llm, COSTS.agent.native_llm),
    costLine('JSON API agent steps', agentTypeCounts.native_json_api, COSTS.agent.native_json_api),
    costLine('Website parse agent steps', agentTypeCounts.native_web_parse, COSTS.agent.native_web_parse),
    costLine('REVERIE custom agent steps', agentTypeCounts.reverie_custom, COSTS.agent.reverie_custom),
    costLine('Receipt and event records', receiptCount, COSTS.receipt),
  ].filter((line) => line.count > 0);
  const rawCost = breakdown.reduce((total, line) => total + line.totalCostStt, 0);
  const agentCost = breakdown
    .filter((line) => /agent/i.test(line.label))
    .reduce((total, line) => total + line.totalCostStt, 0);
  const reactivityCost = breakdown
    .filter((line) => /reactivity|scheduled|trigger/i.test(line.label))
    .reduce((total, line) => total + line.totalCostStt, 0);
  const bufferedCost = rawCost
    + (agentCost * agentBufferPct / 100)
    + (reactivityCost * reactivityBufferPct / 100);
  const totalEstimatedCostStt = roundStt(bufferedCost);
  const minimumBalanceStt = roundStt(Math.max(totalEstimatedCostStt, minimumWorldBalanceStt));
  const warnings = [];
  if (agentStepCount === 0) warnings.push('No live-compatible agent steps are attached to the selected trigger set.');
  if (subscriptionCount === 0) warnings.push('No contract-event or schedule subscriptions are included; autonomy will start from manual triggers only.');
  return {
    minimumBalanceStt,
    recommendedBalanceStt: roundStt(minimumBalanceStt * 1.5),
    totalEstimatedCostStt,
    triggerCount,
    dataSourceCount: dataSourceTriggerCount,
    toolCallCount,
    agentStepCount,
    subscriptionCount,
    graphWeightCount,
    scheduledTickCount,
    receiptCount,
    buffers: {
      agentBufferPct,
      reactivityBufferPct,
      minimumWorldBalanceStt,
    },
    warnings,
    breakdown,
    note: `Minimum estimated cost is ${minimumBalanceStt} STT. REVERIE intentionally overfunds native agent calls because Somnia refunds unused execution budget, while underfunded requests can fail with insufficient budget.`,
  };
}

export function deductRuntimeCost(balance: number, estimate: RuntimeCostEstimate) {
  const cost = estimate.totalEstimatedCostStt || estimate.minimumBalanceStt;
  return {
    costSpentStt: cost,
    nextBalanceStt: roundStt(Math.max(0, balance - cost)),
  };
}
