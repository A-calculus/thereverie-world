'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Check, Plus, X } from 'lucide-react';
import { cacheServerWorld, flushClientCacheToServer, getCachedValue, setCachedValue, upsertCachedAgent } from '@/lib/client/query-cache';
import { useAgents } from '@/lib/hooks/useAgents';
import { getAgentDefaultInput, getAssignedWorld } from '@/lib/shared/agent-identity';
import { agentUrl, worldUrl } from '@/lib/shared/routes';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import type { AgentSummary, WorldSummary } from '@/lib/shared/types';

type WorldDetail = WorldSummary & {
  worldState?: Record<string, unknown>;
};

export default function WorldAgentsPage() {
  const params = useParams();
  const worldId = params.worldId as string;
  const queryClient = useQueryClient();
  const hostWorldSlug = useWorldSlugFromHost();
  const { data: agents = [], isLoading } = useAgents();
  const [world, setWorld] = useState<WorldDetail | null>(() => {
    const cached = getCachedValue<WorldSummary>(`world:${worldId}`);
    return cached ? { ...cached } : null;
  });
  const [agentToAttach, setAgentToAttach] = useState('');
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadWorld() {
      const response = await fetch(`/api/apps/${worldId}`).then((res) => res.json()).catch(() => null);
      if (cancelled || !response) return;
      const nextWorld: WorldDetail = {
        id: response.id,
        name: response.name,
        contractAddress: response.contractAddress,
        template: response.template ?? 'Custom',
        templateSlug: response.templateSlug ?? 'custom',
        status: response.status,
        balance: response.balance ?? '0 STT',
        activeAgents: Array.isArray(response.worldState?.agents) ? response.worldState.agents.length : 0,
        createdAt: response.createdAt,
        worldState: response.worldState ?? {},
      };
      setWorld(nextWorld);
      setCachedValue(`world:${nextWorld.id}`, nextWorld);
    }
    void loadWorld();
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  const assignedAgents = useMemo(() => (
    agents.filter((agent) => getAssignedWorld(agent).id === worldId)
  ), [agents, worldId]);

  const attachableAgents = useMemo(() => (
    agents.filter((agent) => {
      const assigned = getAssignedWorld(agent);
      return agent.status === 'ACTIVE' && (!assigned.id || assigned.id === worldId) && !assignedAgents.some((item) => item.id === agent.id);
    })
  ), [agents, assignedAgents, worldId]);

  const writeWorldAgentList = async (nextAgentIds: string[]) => {
    if (!world) return;
    const worldState = {
      ...(world.worldState ?? {}),
      agents: nextAgentIds,
    };
    const response = await fetch(`/api/apps/${world.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: world.name,
        status: world.status,
        worldState,
      }),
    }).catch(() => null);
    const nextWorld = {
      ...world,
      activeAgents: nextAgentIds.length,
      worldState,
    };
    setWorld(nextWorld);
    cacheServerWorld(nextWorld);
    if (response?.ok) await flushClientCacheToServer();
  };

  const saveAgentAssignment = async (agent: AgentSummary, assigned: boolean) => {
    if (!world) return;
    const currentAssignedWorld = getAssignedWorld(agent);
    if (assigned && currentAssignedWorld.id && currentAssignedWorld.id !== world.id) {
      setMessage(`Unassign this agent from ${currentAssignedWorld.name || currentAssignedWorld.id} before attaching it to another world.`);
      return;
    }
    setBusyAgentId(agent.id);
    setMessage(null);
    const assignment = {
      assignedWorldId: assigned ? world.id : undefined,
      assignedWorldName: assigned ? world.name : undefined,
      assignedWorldAddress: assigned ? world.contractAddress : undefined,
      worldAddress: assigned ? world.contractAddress : undefined,
    };
    const currentInput = getAgentDefaultInput(agent);
    const nextInput = assigned
      ? { ...currentInput, ...assignment }
      : Object.fromEntries(Object.entries(currentInput).filter(([key]) => !['assignedWorldId', 'assignedWorldName', 'assignedWorldAddress', 'worldAddress'].includes(key)));
    const currentConfig = agent.config ?? {};
    const nextConfig = assigned
      ? { ...currentConfig, ...assignment }
      : Object.fromEntries(Object.entries(currentConfig).filter(([key]) => !['assignedWorldId', 'assignedWorldName', 'assignedWorldAddress', 'worldAddress'].includes(key)));

    if (!assigned) {
      nextConfig.persistOnChain = false;
    }

    const body = agent.isOfficial
      ? {
          status: agent.status,
          defaultInput: nextInput,
          persistOnChain: Boolean(agent.config?.persistOnChain) && assigned,
        }
      : {
          name: agent.name,
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          config: nextConfig,
          status: agent.status,
          isPublic: agent.isPublic ?? false,
        };

    const response = await fetch(`/api/agents/${agent.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (!response?.ok) {
      setMessage('Unable to update agent assignment.');
      setBusyAgentId(null);
      return;
    }

    const data = await response.json();
    if (data.agent) {
      upsertCachedAgent(data.agent);
      queryClient.setQueryData<AgentSummary[]>(['agents'], (current = agents) => (
        [data.agent as AgentSummary, ...current.filter((item) => item.id !== data.agent.id)]
      ));
      const currentAgentIds = assignedAgents.map((item) => item.id);
      const nextAgentIds = assigned
        ? Array.from(new Set([...currentAgentIds, agent.id]))
        : currentAgentIds.filter((id) => id !== agent.id);
      await writeWorldAgentList(nextAgentIds);
      await flushClientCacheToServer();
      setMessage(assigned ? 'Agent attached to this world.' : 'Agent removed from this world.');
    }
    setBusyAgentId(null);
  };

  if (!world) return <div className="glass-panel p-4 text-sm text-text-muted">Loading world agents...</div>;

  return (
    <div className="max-w-5xl mx-auto w-full">
      <Link href={worldUrl({ id: worldId, name: world.name, slug: hostWorldSlug })} className="mb-6 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
        <ArrowLeft className="w-4 h-4" /> Back to world
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold mb-1">World Agents</h1>
          <p className="text-text-muted">Attach active agents to {world.name}. Assignment is the only saved world binding path for agents.</p>
        </div>
        <Link href={agentUrl(undefined, '/create')} className="px-4 py-2 bg-dream text-void rounded-lg font-medium flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Agent
        </Link>
      </div>

      {message && <p className="mb-6 rounded-lg border border-teal/20 bg-teal/10 px-3 py-2 text-sm text-teal">{message}</p>}

      <section className="glass-panel p-5 mb-8">
        <h2 className="text-xl font-display font-semibold mb-3">Attach Active Agent</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <select value={agentToAttach} onChange={(event) => setAgentToAttach(event.target.value)} className="bg-void border border-dream/30 rounded-lg px-4 py-3">
            <option value="">Select an active agent</option>
            {attachableAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name} - {agent.type}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!agentToAttach || Boolean(busyAgentId)}
            onClick={() => {
              const agent = agents.find((item) => item.id === agentToAttach);
              if (agent) void saveAgentAssignment(agent, true);
              setAgentToAttach('');
            }}
            className="px-4 py-3 border border-dream/30 rounded-lg flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busyAgentId ? <div className="w-4 h-4 border-2 border-dream/30 border-t-dream rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
            {busyAgentId ? 'Updating...' : 'Attach'}
          </button>
        </div>
        {isLoading && <p className="mt-3 text-sm text-text-muted">Loading agent library...</p>}
        {!isLoading && attachableAgents.length === 0 && (
          <p className="mt-3 text-sm text-text-muted">No active unattached agents are available. Activate an agent before attaching it.</p>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {assignedAgents.length === 0 && (
          <div className="glass-panel p-5 text-sm text-text-muted">No agents are assigned to this world yet.</div>
        )}
        {assignedAgents.map((agent) => (
          <div key={agent.id} className="glass-panel p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-surface border border-dream/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-dream" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-semibold">{agent.name}</h2>
                  <p className="text-xs text-text-muted">{agent.type}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={busyAgentId === agent.id}
                onClick={() => void saveAgentAssignment(agent, false)}
                className="p-2 border border-red-500/20 text-red-300 rounded-lg disabled:opacity-60"
                aria-label={`Remove ${agent.name}`}
              >
                {busyAgentId === agent.id ? <div className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" /> : <X className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-sm text-text-muted">{agent.description}</p>
            <p className="mt-4 text-xs font-mono text-teal break-all">{world.contractAddress}</p>
            <Link href={agentUrl(agent.id)} className="mt-4 inline-flex text-sm text-dream hover:text-aurora">
              View agent
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
