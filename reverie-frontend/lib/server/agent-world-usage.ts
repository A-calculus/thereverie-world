import 'server-only';
import { objectValue } from '@/lib/server/live-world';
import type { WorldBuilderConfig } from '@/lib/shared/types';

export type AgentWorldUsage = {
  id: string;
  name: string;
  contractAddress?: string;
  triggerCount: number;
  stepCount: number;
};

type WorldRow = {
  id: string;
  name: string;
  contract_address?: string | null;
  world_state?: unknown;
};

function builderFromState(worldState: unknown): WorldBuilderConfig | null {
  const state = objectValue(worldState);
  const builder = objectValue(state.builder);
  return Object.keys(builder).length > 0 ? builder as unknown as WorldBuilderConfig : null;
}

function stepMatchesAgent(step: Record<string, unknown>, agentId: string) {
  const candidates = [
    step.id,
    step.agentId,
    step.sdkAgent,
    objectValue(step.config).sdkAgent,
    objectValue(step.config).clonedFromOfficial,
    objectValue(step.config).clonedFromAgentId,
  ];
  return candidates.some((candidate) => typeof candidate === 'string' && candidate === agentId);
}

function stepIdentity(step: Record<string, unknown>) {
  return [
    step.id,
    step.agentId,
    step.sdkAgent,
    objectValue(step.config).sdkAgent,
    objectValue(step.config).clonedFromOfficial,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function buildAgentUsageById(worlds: WorldRow[]) {
  const usage = new Map<string, AgentWorldUsage[]>();

  for (const world of worlds) {
    const builder = builderFromState(world.world_state);
    if (!builder) continue;
    const steps = (builder.agentChain ?? []) as unknown as Record<string, unknown>[];
    const triggers = builder.triggers ?? [];

    for (const step of steps) {
      const identities = stepIdentity(step);
      for (const agentId of identities) {
        const triggerCount = triggers.filter((trigger) => (trigger.agentChain ?? []).some((id) => id === step.id || id === step.agentId || id === agentId)).length;
        const existing = usage.get(agentId) ?? [];
        existing.push({
          id: world.id,
          name: world.name,
          contractAddress: world.contract_address ?? undefined,
          triggerCount,
          stepCount: 1,
        });
        usage.set(agentId, existing);
      }
    }
  }

  for (const [agentId, entries] of usage.entries()) {
    const merged = new Map<string, AgentWorldUsage>();
    for (const entry of entries) {
      const current = merged.get(entry.id);
      merged.set(entry.id, current
        ? {
            ...current,
            triggerCount: current.triggerCount + entry.triggerCount,
            stepCount: current.stepCount + entry.stepCount,
          }
        : entry);
    }
    usage.set(agentId, [...merged.values()]);
  }

  return usage;
}

export function assignedWorldsForAgent(agentId: string, worlds: WorldRow[]) {
  const usage = buildAgentUsageById(worlds);
  if (usage.has(agentId)) return usage.get(agentId) ?? [];

  const matches: AgentWorldUsage[] = [];
  for (const world of worlds) {
    const builder = builderFromState(world.world_state);
    if (!builder) continue;
    const steps = (builder.agentChain ?? []) as unknown as Record<string, unknown>[];
    const matchedSteps = steps.filter((step) => stepMatchesAgent(step, agentId));
    if (matchedSteps.length === 0) continue;
    const stepIds = new Set(matchedSteps.flatMap((step) => stepIdentity(step)));
    matches.push({
      id: world.id,
      name: world.name,
      contractAddress: world.contract_address ?? undefined,
      triggerCount: (builder.triggers ?? []).filter((trigger) => (trigger.agentChain ?? []).some((id) => stepIds.has(id))).length,
      stepCount: matchedSteps.length,
    });
  }
  return matches;
}
