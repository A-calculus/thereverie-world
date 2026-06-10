'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, Pencil, Play, Power } from 'lucide-react';
import { flushClientCacheToServer, getCachedValue, getFreshCachedValue, setCachedValue, upsertCachedAgent } from '@/lib/client/query-cache';
import { agentUrl } from '@/lib/shared/routes';
import type { AgentSummary } from '@/lib/shared/types';

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.agentId as string;
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusSaving, setStatusSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const cached = getCachedValue<AgentSummary>(`agent:${agentId}`);
      if (cached && !cancelled) {
        setAgent(cached);
        setLoading(false);
      }
      if (getFreshCachedValue<AgentSummary>(`agent:${agentId}`)) return;

      try {
        const res = await fetch(`/api/agents/${agentId}`);
        const data = await res.json();
        if (data.agent) {
          setCachedValue(`agent:${agentId}`, data.agent);
        }
        if (!cancelled) setAgent(data.agent ?? null);
      } catch {
        if (!cancelled && !cached) setAgent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const toggleStatus = async () => {
    if (!agent) return;
    setStatusSaving(true);
    const nextStatus: AgentSummary['status'] = agent.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setAgent((current) => current ? { ...current, status: nextStatus } : current);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agent.name,
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          config: agent.config ?? {},
          isPublic: agent.isPublic ?? false,
          status: nextStatus,
          defaultInput: agent.config?.defaultInput ?? {},
          persistOnChain: Boolean(agent.config?.persistOnChain),
        }),
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        if (data.agent) {
          upsertCachedAgent(data.agent);
          await flushClientCacheToServer();
          setAgent(data.agent);
        }
      }
    } finally {
      setStatusSaving(false);
    }
  };

  if (loading) return <div className="glass-panel p-4 text-sm text-text-muted">Loading agent...</div>;
  if (!agent) return <div className="glass-panel p-4 text-sm text-text-muted">Agent not found.</div>;

  return (
    <div className="max-w-5xl mx-auto w-full space-y-8">
      <Link href={agentUrl()} className="inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
        <ArrowLeft className="w-4 h-4" /> Back to agents
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-lg bg-surface border border-dream/20 flex items-center justify-center">
            <Bot className="w-7 h-7 text-dream" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold">{agent.name}</h1>
            <p className="text-text-muted">{agent.description}</p>
            {agent.isOfficial && (
              <p className="mt-2 inline-flex rounded-full border border-aurora/20 bg-aurora/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-aurora">
                Official SDK Agent
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {agent.isOwner !== false && (
            <button
              type="button"
              onClick={toggleStatus}
              disabled={statusSaving}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 border ${
                agent.status === 'ACTIVE'
                  ? 'border-teal/25 bg-teal/10 text-teal'
                  : 'border-dream/20 bg-surface text-text-muted'
              } disabled:opacity-60`}
            >
              {statusSaving ? <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" /> : <Power className="w-4 h-4" />}
              {statusSaving ? 'Saving...' : agent.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            </button>
          )}
          <Link
            href={agent.status === 'ACTIVE' ? agentUrl(agent.id, '/test') : '#'}
            aria-disabled={agent.status !== 'ACTIVE'}
            className={`px-4 py-2 bg-teal text-void rounded-lg font-medium flex items-center gap-2 ${
              agent.status !== 'ACTIVE' ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            <Play className="w-4 h-4" /> Test
          </Link>
          <Link href={agentUrl(agent.id, '/edit')} className="px-4 py-2 border border-dream/30 rounded-lg font-medium flex items-center gap-2">
            <Pencil className="w-4 h-4" /> {agent.isOfficial || agent.isOwner === false ? 'Copy & Edit' : 'Edit'}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-1">Primitive</p>
          <p className="font-mono text-sm">{agent.type}</p>
        </div>
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-1">Status</p>
          <p className={agent.status === 'ACTIVE' ? 'text-teal font-medium' : 'text-text-muted font-medium'}>{agent.status}</p>
        </div>
        <div className="glass-panel p-5">
          <p className="text-sm text-text-muted mb-1">Assigned Worlds</p>
          <p className="font-medium">{agent.worldCount > 0 ? `${agent.worldCount} worlds` : 'Not assigned yet'}</p>
        </div>
      </div>

      <div className="glass-panel p-6">
        <h2 className="text-xl font-display font-semibold mb-4">Runtime Configuration</h2>
        <p className="mb-4 text-sm text-text-muted">
          {agent.isOfficial
            ? 'Official SDK agents keep their fixed name, description, and system prompt. Copy and edit creates a user-owned duplicate for any customization.'
            : 'This is the normalized configuration used by the builder, edit page, and live test page.'}
        </p>
        <div className="bg-void border border-dream/10 rounded-lg p-4 font-mono text-sm text-text-muted overflow-x-auto">
          <pre>{JSON.stringify(agent.config ?? {}, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
