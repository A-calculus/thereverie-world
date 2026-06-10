'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bot, Database, Globe, Play, Square, Zap, BookOpen, GitBranch, Rocket, UploadCloud, Wallet } from 'lucide-react';
import { cacheServerWorld } from '@/lib/client/query-cache';
import { worldUrl } from '@/lib/shared/routes';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import { estimateRuntimeCost } from '@/lib/shared/world-runtime/lifecycle';
import type { AgentType, WorldBuilderAgentStep, WorldBuilderConfig, WorldRuntimeRun, WorldSummary } from '@/lib/shared/types';

type DashboardWorldState = Record<string, unknown> & {
  agents?: string[];
  builder?: WorldBuilderConfig;
  fundingHistory?: Array<Record<string, unknown>>;
  latestRun?: WorldRuntimeRun;
  latestTick?: Record<string, unknown>;
};

function parseStt(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fundingAmount(entry: Record<string, unknown>): number {
  const value = entry.amountStt ?? entry.amount;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function agentLane(agentType: AgentType) {
  if (agentType === 'reverie_custom') return 'REVERIE';
  return 'Lane A';
}

function namedAgentFromId(id: string): WorldBuilderAgentStep {
  return {
    id,
    name: id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
    agentType: 'reverie_custom',
    purpose: 'Assigned world agent',
    inputTemplate: '{{trigger.payload}}',
  };
}

export default function WorldDashboardPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const worldId = params.worldId as string;
  const [runtimeSlug, setRuntimeSlug] = useState(worldId);
  const [worldName, setWorldName] = useState('');
  const [worldStatus, setWorldStatus] = useState<'draft' | 'deployed' | 'running' | 'stopped'>('draft');
  const [worldBalance, setWorldBalance] = useState('0 STT');
  const [contractAddress, setContractAddress] = useState('');
  const [latestRun, setLatestRun] = useState<WorldRuntimeRun | null>(null);
  const [latestTick, setLatestTick] = useState<Record<string, unknown> | null>(null);
  const [latestActivity, setLatestActivity] = useState<{ at?: string | null; kind?: string | null; summary?: string | null }>({});
  const [builder, setBuilder] = useState<WorldBuilderConfig | null>(null);
  const [worldState, setWorldState] = useState<DashboardWorldState>({});
  const [action, setAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('Lifecycle actions are live and require wallet signatures from world settings.');
  const [funding, setFunding] = useState('0.5');
  const hostWorldSlug = useWorldSlugFromHost();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/apps/${worldId}/builder`).then((res) => res.json()).catch(() => null),
      fetch(`/api/apps/${worldId}`).then((res) => res.json()).catch(() => null),
      fetch(`/api/apps/${worldId}/runtime/live`).then((res) => res.json()).catch(() => null),
    ]).then(([builderData, worldData, liveData]) => {
      if (cancelled) return;
      const nextWorldState = (worldData?.worldState && typeof worldData.worldState === 'object' ? worldData.worldState : {}) as DashboardWorldState;
      const nextBuilder = (builderData?.builder ?? nextWorldState.builder ?? null) as WorldBuilderConfig | null;
      if (nextBuilder?.uiSlug) setRuntimeSlug(nextBuilder.uiSlug);
      if (worldData?.name) setWorldName(worldData.name);
      if (worldData?.status) setWorldStatus(worldData.status);
      if (worldData?.balance) setWorldBalance(worldData.balance);
      if (worldData?.contractAddress) setContractAddress(worldData.contractAddress);
      setBuilder(nextBuilder);
      setWorldState(nextWorldState);
      if (nextWorldState.latestRun) setLatestRun(nextWorldState.latestRun);
      if (nextWorldState.latestTick) setLatestTick(nextWorldState.latestTick);
      setLatestActivity({
        at: typeof liveData?.latestActivityAt === 'string' ? liveData.latestActivityAt : null,
        kind: typeof liveData?.latestActivityKind === 'string' ? liveData.latestActivityKind : null,
        summary: typeof liveData?.latestActivitySummary === 'string' ? liveData.latestActivitySummary : null,
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  // Formatting helper
  const formatName = (id: string) => {
    return id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const activeAgents = useMemo(() => {
    const steps = builder?.agentChain ?? [];
    const seen = new Set(steps.flatMap((agent) => [agent.id, agent.agentId].filter(Boolean) as string[]));
    const assigned = Array.isArray(worldState.agents) ? worldState.agents : [];
    return [
      ...steps,
      ...assigned.filter((id) => !seen.has(id)).map(namedAgentFromId),
    ];
  }, [builder?.agentChain, worldState.agents]);

  const activeTriggerCount = useMemo(() => (
    builder?.triggers?.filter((trigger) => trigger.isActive).length ?? 0
  ), [builder?.triggers]);

  const balanceNumber = parseStt(worldBalance);
  const runtimeStatus = typeof worldState.runtime === 'object' && worldState.runtime && !Array.isArray(worldState.runtime)
    ? String((worldState.runtime as Record<string, unknown>).status ?? worldStatus)
    : worldStatus;
  const published = Boolean(builder?.lastPublishedAt);
  const minimumRunCost = builder ? estimateRuntimeCost(builder).minimumBalanceStt : 0;
  const canArm = (worldStatus === 'deployed' || worldStatus === 'stopped') && runtimeStatus !== 'armed' && published && balanceNumber >= minimumRunCost && minimumRunCost > 0;
  const canTick = worldStatus === 'running' || runtimeStatus === 'armed';
  const totalFundedFromHistory = (worldState.fundingHistory ?? []).reduce((total, entry) => total + fundingAmount(entry), 0);
  const totalFunded = Math.max(totalFundedFromHistory, balanceNumber);
  const totalSpent = Math.max(0, totalFunded - balanceNumber);
  const spentPercent = totalFunded > 0 ? Math.min(100, Math.max(0, (totalSpent / totalFunded) * 100)) : 0;
  const latestRunTime = latestRun?.createdAt ? new Date(latestRun.createdAt).getTime() : 0;
  const latestActivityTime = latestActivity.at ? new Date(latestActivity.at).getTime() : 0;
  const preferLatestActivity = Boolean(latestActivity.at && (latestRun?.status === 'pending' || latestActivityTime >= latestRunTime));

  const applyWorldResponse = (response: Record<string, unknown>) => {
    const responseWorld = response.world as { id?: string; name?: string; status?: typeof worldStatus; balance?: string; contractAddress?: string } | undefined;
    if (responseWorld?.id) {
      const summary = responseWorld as WorldSummary;
      cacheServerWorld(summary);
      queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
        [summary, ...current.filter((item) => item.id !== responseWorld.id)]
      ));
      if (responseWorld.status) setWorldStatus(responseWorld.status);
      if (responseWorld.balance) setWorldBalance(responseWorld.balance);
      if (responseWorld.contractAddress) setContractAddress(responseWorld.contractAddress);
      if (responseWorld.name) setWorldName(responseWorld.name);
    }
    if (response.worldState && typeof response.worldState === 'object' && !Array.isArray(response.worldState)) {
      const nextState = response.worldState as DashboardWorldState;
      setWorldState(nextState);
      if (nextState.latestRun) setLatestRun(nextState.latestRun);
      if (nextState.latestTick) setLatestTick(nextState.latestTick);
      if (nextState.builder) setBuilder(nextState.builder);
    }
  };

  const lifecycleAction = async (name: string, request: () => Promise<Record<string, unknown>>, success: string) => {
    setAction(name);
    setActionMessage(`${success.replace(/\.$/, '')}...`);
    try {
      const response = await request();
      if (typeof response.error === 'string') {
        setActionMessage(response.error);
      } else {
        applyWorldResponse(response);
        setActionMessage(success);
      }
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Lifecycle action failed.');
    } finally {
      setAction(null);
    }
  };

  const openSettings = () => {
    window.location.href = worldUrl({ id: worldId, name: worldName, slug: hostWorldSlug }, '/settings');
  };
  const openRuntime = () => {
    window.location.href = worldUrl({ id: worldId, name: worldName, slug: hostWorldSlug }, `/${runtimeSlug}`);
  };
  const deployWorld = openSettings;
  const publishWorld = () => lifecycleAction('publish', () => fetch(`/api/apps/${worldId}/builder/publish`, { method: 'POST' }).then((res) => res.json()), 'Runtime published.');
  const fundWorld = openSettings;
  const armWorld = openSettings;
  const tickWorld = openRuntime;
  const stopWorld = openSettings;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-surface border border-dream/20 flex items-center justify-center shrink-0">
            <Globe className={`w-8 h-8 ${worldStatus === 'running' ? 'text-teal' : 'text-text-muted'}`} />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-display font-bold">{worldName || formatName(worldId)}</h1>
              <div className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                worldStatus === 'running' 
                  ? 'bg-teal/10 border-teal/20 text-teal'
                  : 'bg-surface border-dream/20 text-text-muted'
              }`}>
                {worldStatus.toUpperCase()}
              </div>
            </div>
            <p className="text-text-muted text-sm font-mono bg-surface inline-block px-2 py-0.5 rounded border border-dream/10">
              {contractAddress || 'Not deployed yet'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href={worldUrl({ id: worldId, name: worldName, slug: hostWorldSlug }, '/settings')} className="px-4 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 border border-dream/30 hover:bg-dream/10 text-text-primary">
            {worldStatus === 'running' ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            Manage Lifecycle
          </Link>
        </div>
      </div>

      <div className="glass-panel p-5 mb-8 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Lifecycle</h2>
            <p className="text-sm text-text-muted">
              Runtime state: <span className="font-mono text-dream">{runtimeStatus}</span>
              {published ? ' / published' : ' / unpublished'}
              {minimumRunCost > 0 ? ` / minimum ${minimumRunCost} STT` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {worldStatus === 'draft' && (
              <button onClick={deployWorld} disabled={Boolean(action)} className="px-4 py-2 bg-dream text-void rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-60">
                {action === 'deploy' ? <span className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Rocket className="w-4 h-4" />}
                Deploy Live World
              </button>
            )}
            {worldStatus !== 'draft' && !published && (
              <button onClick={publishWorld} disabled={Boolean(action)} className="px-4 py-2 bg-dream text-void rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-60">
                {action === 'publish' ? <span className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {action === 'publish' ? 'Publishing...' : 'Publish Runtime'}
              </button>
            )}
            {worldStatus !== 'draft' && (
              <div className="flex rounded-lg overflow-hidden border border-teal/30">
                <input value={funding} onChange={(event) => setFunding(event.target.value)} className="w-24 bg-void px-3 py-2 text-sm outline-none" />
                <button onClick={fundWorld} disabled={Boolean(action)} className="px-3 py-2 bg-teal text-void font-semibold inline-flex items-center gap-2 disabled:opacity-60">
                  {action === 'fund' ? <span className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Wallet className="w-4 h-4" />}
                  Fund
                </button>
              </div>
            )}
            {canArm && (
              <button onClick={armWorld} disabled={Boolean(action)} className="px-4 py-2 bg-teal text-void rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-60">
                {action === 'arm' ? <span className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
                {action === 'arm' ? 'Applying & arming...' : worldStatus === 'stopped' ? 'Apply & Restart Runtime' : 'Apply & Arm Runtime'}
              </button>
            )}
            {canTick && (
              <button onClick={tickWorld} disabled={Boolean(action)} className="px-4 py-2 bg-teal text-void rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-60">
                {action === 'tick' ? <span className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
                {runtimeStatus === 'armed' ? 'Open Start Trigger' : 'Live Status'}
              </button>
            )}
            {worldStatus === 'running' && (
              <button onClick={stopWorld} disabled={Boolean(action)} className="px-4 py-2 border border-dream/30 rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-60">
                {action === 'stop' ? <span className="w-4 h-4 border-2 border-dream/30 border-t-dream rounded-full animate-spin" /> : <Square className="w-4 h-4" />}
                Stop World
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-text-muted">{actionMessage}</p>
        {worldStatus !== 'draft' && published && !canArm && runtimeStatus !== 'armed' && worldStatus !== 'running' && (
          <p className="text-xs text-text-muted">Fund at least the minimum estimated runtime cost before arming the world.</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="glass-panel p-6 col-span-1 lg:col-span-2">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-dream" />
            STT Balance & Fuel
          </h2>
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
            <div>
              <p className="text-4xl font-display font-bold text-gradient mb-1">{worldBalance}</p>
              <p className="text-sm text-text-muted">Live autonomous runtime fuel</p>
            </div>
            <div className="w-full sm:w-1/2">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-text-muted">Funded fuel spent</span>
                <span>{totalSpent.toFixed(3)} / {totalFunded.toFixed(3)} STT</span>
              </div>
              <div className="h-2 w-full bg-void rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-dream to-teal transition-all" style={{ width: `${spentPercent}%` }} />
              </div>
              <p className="mt-2 text-xs text-text-muted">{balanceNumber.toFixed(3)} STT remaining</p>
            </div>
            <Link href={worldUrl({ id: worldId, name: worldName, slug: hostWorldSlug }, '/settings')} className="px-4 py-2 bg-surface hover:bg-dream/10 border border-dream/30 rounded-lg text-sm font-medium transition-colors shrink-0">
              Fund World
            </Link>
          </div>
        </div>

        <div className="glass-panel p-6 flex flex-col justify-between">
          <h2 className="text-lg font-medium mb-2 flex items-center gap-2">
            <Bot className="w-5 h-5 text-aurora" />
            Active Agents
          </h2>
          <div className="space-y-3">
            {activeAgents.slice(0, 5).map((agent) => (
              <div key={`${agent.agentId ?? agent.id}:${agent.name}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{agent.name}</span>
                <span className="shrink-0 text-teal font-medium">{agentLane(agent.agentType)}</span>
              </div>
            ))}
            {activeAgents.length === 0 && (
              <p className="text-sm text-text-muted">No agents are attached to this world yet.</p>
            )}
            {activeAgents.length > 5 && (
              <p className="text-xs text-text-muted">+{activeAgents.length - 5} more assigned agents</p>
            )}
          </div>
        </div>
      </div>

      <div className="glass-panel p-6 mb-8">
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-dream" />
          Latest World Result
        </h2>
        {preferLatestActivity ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-text-muted">Last activity</p>
              <p className="font-medium break-all">{latestActivity.kind ?? 'runtime_activity'}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-sm text-text-muted">Time</p>
              <p className="font-mono text-sm text-text-muted break-all">{latestActivity.at}</p>
            </div>
            <p className="md:col-span-3 rounded-lg border border-dream/10 bg-void p-4 text-xs text-text-muted whitespace-pre-wrap break-words">{latestActivity.summary ?? 'A live world activity was recorded.'}</p>
          </div>
        ) : latestRun ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-text-muted">Last action</p>
              <p className="font-medium break-all">{latestRun.actionId}</p>
            </div>
            <div>
              <p className="text-sm text-text-muted">Status</p>
              <p className="font-medium capitalize">{latestRun.status}</p>
            </div>
            <div>
              <p className="text-sm text-text-muted">Run</p>
              <p className="font-medium">{String(latestTick?.tickNumber ? `Run ${latestTick.tickNumber}` : 'Manual or start trigger')}</p>
            </div>
            <pre className="md:col-span-3 rounded-lg border border-dream/10 bg-void p-4 text-xs text-text-muted whitespace-pre-wrap break-words">{JSON.stringify(latestRun.summary, null, 2)}</pre>
          </div>
        ) : (
          <p className="text-sm text-text-muted">No runtime result has been recorded yet. Deploy, fund, arm, or fire a manual trigger to create one.</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href={worldUrl({ id: worldId, name: worldName, slug: hostWorldSlug }, `/${runtimeSlug}`)} className="glass-panel p-6 glass-panel-hover group">
          <div className="w-10 h-10 rounded-lg bg-teal/10 flex items-center justify-center mb-4 text-teal transition-transform group-hover:scale-110">
            <GitBranch className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-medium mb-2">Published Runtime</h3>
          <p className="text-text-muted text-sm mb-4">
            Open the generated runtime, inspect world graph state, run manual triggers, and view receipts.
          </p>
          <div className="flex items-center text-teal text-sm font-medium">
            Open Runtime <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        <Link href={worldUrl({ id: worldId, name: worldName, slug: hostWorldSlug }, '/builder')} className="glass-panel p-6 glass-panel-hover group">
          <div className="w-10 h-10 rounded-lg bg-aurora/10 flex items-center justify-center mb-4 text-aurora transition-transform group-hover:scale-110">
            <Bot className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-medium mb-2">World UI Builder</h3>
          <p className="text-text-muted text-sm mb-4">
            Configure runtime UI, public JSON data sources, agent chains, saved config, and server secrets.
          </p>
          <div className="flex items-center text-aurora text-sm font-medium">
            Edit Builder <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        <Link href={worldUrl({ id: worldId, name: worldName, slug: hostWorldSlug }, '/triggers')} className="glass-panel p-6 glass-panel-hover group">
          <div className="w-10 h-10 rounded-lg bg-teal/10 flex items-center justify-center mb-4 text-teal transition-transform group-hover:scale-110">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-medium mb-2">Triggers & Reactivity</h3>
          <p className="text-text-muted text-sm mb-4">
            Wire real-world data feeds to your agents. {activeTriggerCount} active {activeTriggerCount === 1 ? 'trigger is' : 'triggers are'} currently watching conditions.
          </p>
          <div className="flex items-center text-teal text-sm font-medium">
            Manage Triggers <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        <Link href={worldUrl({ id: worldId, name: worldName, slug: hostWorldSlug }, '/events')} className="glass-panel p-6 glass-panel-hover group">
          <div className="w-10 h-10 rounded-lg bg-dream/10 flex items-center justify-center mb-4 text-dream transition-transform group-hover:scale-110">
            <BookOpen className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-medium mb-2">Live Event Stream</h3>
          <p className="text-text-muted text-sm mb-4">
            Watch live world events and view Proof-of-Thought receipts for every agent decision.
          </p>
          <div className="flex items-center text-dream text-sm font-medium">
            View Events <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
      </div>
    </div>
  );
}
