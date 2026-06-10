import { REVERIE_SDK_AGENT_DEFINITIONS } from '@worldframe/sdk/browser';
import type { AgentSummary } from './types';

const sdkAgentSlug: Record<string, NonNullable<AgentSummary['sdkAgent']>> = {
  chronicle: 'chronicle',
  zoneClimate: 'zoneClimate',
  factionMorale: 'factionMorale',
  conflict: 'conflict',
};

const frontendAgentId: Record<string, string> = {
  chronicle: 'chronicle',
  zoneClimate: 'zone-climate',
  factionMorale: 'faction-morale',
  conflict: 'conflict',
};

export const officialSdkAgents: AgentSummary[] = REVERIE_SDK_AGENT_DEFINITIONS.map((definition) => ({
  id: frontendAgentId[definition.id],
  name: definition.name,
  type: definition.primitive,
  description: definition.description,
  status: definition.id === 'zoneClimate' ? 'ACTIVE' : 'INACTIVE',
  worldCount: 0,
  createdAt: '2026-05-30T09:00:00.000Z',
  systemPrompt: definition.systemPrompt,
  config: {
    sdkAgent: definition.className,
    method: definition.method,
    editable: definition.editable,
    defaultInput: definition.defaultInput,
    allowedValues: definition.allowedValues ?? [],
    estimate: definition.estimate,
  },
  isPublic: true,
  isOfficial: true,
  isOwner: true,
  sdkAgent: sdkAgentSlug[definition.id],
}));

export function getOfficialSdkAgent(agentId: string): AgentSummary | undefined {
  return officialSdkAgents.find((agent) => agent.id === agentId || agent.sdkAgent === agentId);
}

export function mergeOfficialSdkAgent(
  agent: AgentSummary,
  preference?: {
    status?: AgentSummary['status'];
    default_input?: Record<string, unknown> | null;
    persist_on_chain?: boolean | null;
  } | null
): AgentSummary {
  const defaultInput = agent.config?.defaultInput && typeof agent.config.defaultInput === 'object'
    ? agent.config.defaultInput as Record<string, unknown>
    : {};

  const mergedDefaultInput = {
    ...defaultInput,
    ...(preference?.default_input ?? {}),
  };

  return {
    ...agent,
    status: preference?.status ?? agent.status,
    worldCount: 0,
    config: {
      ...(agent.config ?? {}),
      defaultInput: mergedDefaultInput,
      persistOnChain: preference?.persist_on_chain ?? Boolean(agent.config?.persistOnChain),
    },
  };
}
