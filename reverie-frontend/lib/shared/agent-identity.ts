import type { AgentSummary } from './types';

export const LOCKED_AGENT_INPUT_KEYS = [
  'zoneId',
  'factionId',
  'agentId',
  'worldId',
  'worldAddress',
  'assignedWorldId',
  'assignedWorldName',
  'assignedWorldAddress',
] as const;

const ASSIGNMENT_KEYS = ['assignedWorldId', 'assignedWorldName', 'assignedWorldAddress', 'worldAddress'] as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function createDeterministicAgentEntityId(worldKey: string, name: string, prefix: string): string {
  const base = `${worldKey || 'unassigned-world'}:${name || 'unnamed'}`;
  return `${prefix}-${slugify(name)}-${stableHash(base)}`;
}

export function getAgentDefaultInput(agent: AgentSummary | null | undefined): Record<string, unknown> {
  const input = agent?.config?.defaultInput;
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

export function getAssignedWorld(agent: AgentSummary | null | undefined) {
  const input = getAgentDefaultInput(agent);
  const config = agent?.config ?? {};
  const assignedWorldId = config.assignedWorldId ?? input.assignedWorldId;
  const assignedWorldName = config.assignedWorldName ?? input.assignedWorldName;
  const assignedWorldAddress = config.assignedWorldAddress ?? config.worldAddress ?? input.assignedWorldAddress ?? input.worldAddress;

  return {
    id: typeof assignedWorldId === 'string' ? assignedWorldId : '',
    name: typeof assignedWorldName === 'string' ? assignedWorldName : '',
    address: typeof assignedWorldAddress === 'string' ? assignedWorldAddress : '',
  };
}

function preserveOrRemoveLockedKeys(
  next: Record<string, unknown>,
  original: Record<string, unknown>,
  worldKey: string,
  agentName: string
): Record<string, unknown> {
  const sanitized = { ...next };
  const hadNextZoneId = next.zoneId !== undefined;
  const hadNextFactionId = next.factionId !== undefined;

  for (const key of LOCKED_AGENT_INPUT_KEYS) {
    if (original[key] !== undefined) {
      sanitized[key] = original[key];
    } else {
      delete sanitized[key];
    }
  }

  if (sanitized.zoneId === undefined && original.zoneId === undefined && hadNextZoneId && worldKey) {
    sanitized.zoneId = `0x${stableHash(`${worldKey}:${agentName}:zone`).repeat(8)}`;
  }
  if (sanitized.factionId === undefined && original.factionId === undefined && hadNextFactionId && worldKey) {
    sanitized.factionId = createDeterministicAgentEntityId(worldKey, agentName, 'faction');
  }

  return sanitized;
}

export function sanitizeAgentConfigForSave(
  nextConfig: Record<string, unknown>,
  originalConfig: Record<string, unknown>,
  agentName: string
): Record<string, unknown> {
  const assignedWorld = getAssignedWorld({ id: '', name: agentName, type: 'native_llm', description: '', status: 'ACTIVE', worldCount: 0, createdAt: '', config: originalConfig });
  const worldKey = assignedWorld.address || assignedWorld.id;
  const sanitized = preserveOrRemoveLockedKeys(nextConfig, originalConfig, worldKey, agentName);

  const originalInput = originalConfig.defaultInput && typeof originalConfig.defaultInput === 'object' && !Array.isArray(originalConfig.defaultInput)
    ? originalConfig.defaultInput as Record<string, unknown>
    : {};
  const nextInput = sanitized.defaultInput && typeof sanitized.defaultInput === 'object' && !Array.isArray(sanitized.defaultInput)
    ? sanitized.defaultInput as Record<string, unknown>
    : {};

  sanitized.defaultInput = preserveOrRemoveLockedKeys(nextInput, originalInput, worldKey, agentName);

  for (const key of ASSIGNMENT_KEYS) {
    if (originalConfig[key] !== undefined) sanitized[key] = originalConfig[key];
  }

  return sanitized;
}
