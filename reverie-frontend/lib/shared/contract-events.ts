import { decodeEventLog, keccak256, parseAbiItem, toBytes } from 'viem';
import type { AbiEvent } from 'viem';
import type { ContractEventConfig, ContractEventDataPoint, ContractEventDataPointCondition } from './types';

export type ContractLogLike = {
  address?: string;
  blockNumber?: bigint | number | null;
  transactionHash?: string | null;
  logIndex?: number | null;
  topics?: readonly string[];
  data?: string;
};

export const LOG_METADATA_POINTS: ContractEventDataPoint[] = [
  { id: 'address', label: 'Emitter address', path: 'meta.address', alias: 'address', include: true },
  { id: 'blockNumber', label: 'Block number', path: 'meta.blockNumber', alias: 'blockNumber', include: true },
  { id: 'transactionHash', label: 'Transaction hash', path: 'meta.transactionHash', alias: 'transactionHash', include: true },
  { id: 'logIndex', label: 'Log index', path: 'meta.logIndex', alias: 'logIndex', include: true },
  { id: 'topic0', label: 'Topic 0', path: 'topics.0', alias: 'topic0', include: false },
  { id: 'topic1', label: 'Topic 1', path: 'topics.1', alias: 'topic1', include: false },
  { id: 'topic2', label: 'Topic 2', path: 'topics.2', alias: 'topic2', include: false },
  { id: 'topic3', label: 'Topic 3', path: 'topics.3', alias: 'topic3', include: false },
  { id: 'rawData', label: 'Raw data', path: 'rawData', alias: 'rawData', include: false },
];

export const KNOWN_WORLD_EVENT_SIGNATURES = [
  'event ZoneUpdated(bytes32 indexed zoneId, string newFaction, uint256 newDanger)',
  'event ChronicleAdded(uint256 eventIndex, string description)',
  'event AgentDecisionRequested(uint256 indexed requestId, bytes32 indexed triggerId)',
  'event AgentDecisionReceived(uint256 indexed requestId, string result)',
  'event NativeAgentRequested(uint256 indexed requestId, uint8 indexed agent, bytes32 indexed triggerId)',
  'event ReactivitySubscribed(uint256 indexed subscriptionId, bytes32 eventSig)',
  'event TriggerFired(bytes32 indexed triggerId, string context)',
] as const;

export type KnownWorldEventName =
  | 'ZoneUpdated'
  | 'ChronicleAdded'
  | 'AgentDecisionRequested'
  | 'AgentDecisionReceived'
  | 'NativeAgentRequested'
  | 'ReactivitySubscribed'
  | 'TriggerFired';

type EventInput = {
  name?: string;
  type: string;
  indexed?: boolean;
};

type ParsedEvent = AbiEvent & {
  name: string;
  inputs: readonly EventInput[];
};

export function stringifyContractValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
}

export function sanitizePayloadAlias(value: string, fallback: string) {
  const next = value.trim().replace(/[^A-Za-z0-9_]/g, '');
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(next)) return next;
  return fallback;
}

function readPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)];
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

function eventSignature(event: ParsedEvent) {
  return `${event.name}(${event.inputs.map((input) => input.type).join(',')})`;
}

export function eventTopic0(signature: string) {
  const normalized = signature.trim().startsWith('event ')
    ? eventSignature(parseAbiItem(signature.trim()) as ParsedEvent)
    : signature.trim();
  return keccak256(toBytes(normalized));
}

export function knownWorldEvents() {
  return KNOWN_WORLD_EVENT_SIGNATURES.map((signature) => {
    const abi = parseAbiItem(signature) as ParsedEvent;
    return {
      name: abi.name as KnownWorldEventName,
      signature: eventSignature(abi),
      topic0: eventTopic0(signature),
      abi,
      args: abi.inputs.map((input, index) => ({
        id: input.name || `arg${index}`,
        name: input.name || `arg${index}`,
        type: input.type,
        indexed: Boolean(input.indexed),
      })),
    };
  });
}

export function getKnownWorldEvent(nameOrSignature: string | undefined) {
  if (!nameOrSignature) return knownWorldEvents()[0];
  return knownWorldEvents().find((event) => event.name === nameOrSignature || event.signature === nameOrSignature || event.topic0 === nameOrSignature) ?? knownWorldEvents()[0];
}

function parseCustomAbiEvents(abiJson: string | undefined, eventSignatureText: string | undefined): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  if (abiJson?.trim()) {
    try {
      const parsed = JSON.parse(abiJson);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'event') {
          events.push(entry as ParsedEvent);
        }
      }
    } catch {
      /* ignore invalid JSON until validation surfaces through empty events */
    }
  }
  if (eventSignatureText?.trim()) {
    try {
      const signature = eventSignatureText.trim().startsWith('event ')
        ? eventSignatureText.trim()
        : `event ${eventSignatureText.trim()}`;
      events.push(parseAbiItem(signature) as ParsedEvent);
    } catch {
      /* ignore invalid signature until validation surfaces through empty events */
    }
  }
  return events;
}

export function customContractEventChoices(config: ContractEventConfig | undefined) {
  return parseCustomAbiEvents(config?.abiJson, config?.eventSignature).map((event) => ({
    name: event.name,
    signature: eventSignature(event),
    topic0: eventTopic0(eventSignature(event)),
    args: event.inputs.map((input, index) => ({
      id: input.name || `arg${index}`,
      name: input.name || `arg${index}`,
      type: input.type,
      indexed: Boolean(input.indexed),
    })),
  }));
}

export function contractEventAbi(config: ContractEventConfig | undefined): ParsedEvent | null {
  if (!config || config.mode === 'raw_topics') return null;
  if (config.mode === 'world_abi') return getKnownWorldEvent(config.eventName ?? config.eventSignature).abi;
  const customEvents = parseCustomAbiEvents(config.abiJson, config.eventSignature);
  return customEvents.find((event) => event.name === config.eventName) ?? customEvents[0] ?? null;
}

export function contractEventTopic0(config: ContractEventConfig | undefined): string | undefined {
  if (!config) return undefined;
  if (config.mode === 'raw_topics') return config.topic0 || undefined;
  const abi = contractEventAbi(config);
  return abi ? eventTopic0(eventSignature(abi)) : config.topic0 || undefined;
}

export function contractEventDataPointOptions(config: ContractEventConfig | undefined): ContractEventDataPoint[] {
  const abi = contractEventAbi(config);
  const argPoints: ContractEventDataPoint[] = abi
    ? abi.inputs.map((input, index) => {
        const id = input.name || `arg${index}`;
        return {
          id,
          label: `${id} (${input.type}${input.indexed ? ', indexed' : ''})`,
          path: `args.${id}`,
          alias: sanitizePayloadAlias(id, `arg${index}`),
          include: true,
        };
      })
    : [];
  return [...LOG_METADATA_POINTS, ...argPoints];
}

export function normalizeContractEventDataPoints(config: ContractEventConfig | undefined): ContractEventDataPoint[] {
  const options = contractEventDataPointOptions(config);
  const current = new Map((config?.dataPoints ?? []).map((point) => [point.id, point]));
  return options.map((option) => {
    const existing = current.get(option.id);
    return {
      ...option,
      ...existing,
      alias: sanitizePayloadAlias(existing?.alias ?? option.alias, option.alias),
      path: existing?.path ?? option.path,
      include: existing?.include ?? option.include,
    };
  });
}

export function decodeContractLog(config: ContractEventConfig, log: ContractLogLike) {
  const meta = {
    address: log.address ?? '',
    blockNumber: typeof log.blockNumber === 'bigint' ? log.blockNumber.toString() : log.blockNumber ?? null,
    transactionHash: log.transactionHash ?? '',
    logIndex: log.logIndex ?? null,
  };
  const base = {
    meta,
    topics: [...(log.topics ?? [])],
    rawData: log.data ?? '0x',
    args: {} as Record<string, unknown>,
  };
  const abi = contractEventAbi(config);
  if (!abi) return base;
  try {
    const decoded = decodeEventLog({
      abi: [abi],
      data: (log.data ?? '0x') as `0x${string}`,
      topics: [...(log.topics ?? [])] as [`0x${string}`, ...`0x${string}`[]],
    });
    base.args = decoded.args && typeof decoded.args === 'object' && !Array.isArray(decoded.args)
      ? decoded.args as Record<string, unknown>
      : {};
  } catch {
    base.args = {};
  }
  return base;
}

export function evaluateContractDataPointCondition(value: unknown, condition?: ContractEventDataPointCondition) {
  if (!condition?.enabled) return { passed: true, reason: 'Condition disabled.' };
  const operator = condition.operator ?? 'exists';
  const compareValue = condition.compareValue ?? '';
  const actualValue = stringifyContractValue(value);
  if (operator === 'exists') {
    const passed = value !== undefined && value !== null && actualValue !== '';
    return { passed, reason: passed ? 'Value exists.' : 'Value is missing, null, or empty.' };
  }
  if (operator === 'equals') return { passed: actualValue === compareValue, reason: `Actual value ${actualValue === compareValue ? 'equals' : 'does not equal'} expected value.` };
  if (operator === 'not_equals') return { passed: actualValue !== compareValue, reason: `Actual value ${actualValue !== compareValue ? 'does not equal' : 'equals'} blocked value.` };
  if (operator === 'contains') return { passed: actualValue.includes(compareValue), reason: `Actual value ${actualValue.includes(compareValue) ? 'contains' : 'does not contain'} expected text.` };
  const left = Number(actualValue);
  const right = Number(compareValue);
  const numeric = Number.isFinite(left) && Number.isFinite(right);
  if (operator === 'greater_than') return { passed: numeric && left > right, reason: numeric ? `${left} > ${right} ${left > right ? 'passed' : 'failed'}.` : 'Numeric comparison failed.' };
  if (operator === 'less_than') return { passed: numeric && left < right, reason: numeric ? `${left} < ${right} ${left < right ? 'passed' : 'failed'}.` : 'Numeric comparison failed.' };
  return { passed: true, reason: 'No condition configured.' };
}

export function buildContractEventPayload(config: ContractEventConfig, log: ContractLogLike) {
  const decoded = decodeContractLog(config, log);
  const points = normalizeContractEventDataPoints(config).filter((point) => point.include);
  const payload: Record<string, unknown> = {};
  const evaluations = points.map((point) => {
    const value = readPath(decoded, point.path);
    payload[sanitizePayloadAlias(point.alias, point.id)] = value;
    const evaluation = evaluateContractDataPointCondition(value, point.condition);
    return { point, value, ...evaluation };
  });
  return {
    payload,
    decoded,
    evaluations,
    passed: evaluations.every((evaluation) => evaluation.passed),
  };
}

export function contractLogKey(triggerId: string, log: ContractLogLike) {
  return `${triggerId}:${log.transactionHash ?? 'pending'}:${log.logIndex ?? 0}`;
}
