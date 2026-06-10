export const AGENT_ASSIGNMENT_KEYS = ['assignedWorldId', 'assignedWorldName', 'assignedWorldAddress', 'worldAddress'] as const;

export class AgentAssignmentError extends Error {
  constructor(public readonly assignedWorldName: string, public readonly assignedWorldId: string) {
    super(`Unassign this agent from ${assignedWorldName || assignedWorldId || 'its current world'} before attaching it to another world.`);
    this.name = 'AgentAssignmentError';
  }
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function assignedWorldFromConfig(config: Record<string, unknown>) {
  const defaultInput = objectValue(config.defaultInput);
  const assignedWorldId = config.assignedWorldId ?? defaultInput.assignedWorldId;
  const assignedWorldName = config.assignedWorldName ?? defaultInput.assignedWorldName;
  const assignedWorldAddress = config.assignedWorldAddress ?? config.worldAddress ?? defaultInput.assignedWorldAddress ?? defaultInput.worldAddress;
  return {
    id: typeof assignedWorldId === 'string' ? assignedWorldId : '',
    name: typeof assignedWorldName === 'string' ? assignedWorldName : '',
    address: typeof assignedWorldAddress === 'string' ? assignedWorldAddress : '',
  };
}

export function worldCountFromConfig(config: Record<string, unknown>) {
  return assignedWorldFromConfig(config).id ? 1 : 0;
}

export function assertAgentAssignableToWorld(config: Record<string, unknown>, targetWorldId: string) {
  const assigned = assignedWorldFromConfig(config);
  if (assigned.id && assigned.id !== targetWorldId) {
    throw new AgentAssignmentError(assigned.name, assigned.id);
  }
}

export function clearAssignment(config: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !AGENT_ASSIGNMENT_KEYS.includes(key as typeof AGENT_ASSIGNMENT_KEYS[number])));
}
