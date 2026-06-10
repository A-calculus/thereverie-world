'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Bot, Globe, Plus, Wrench, Zap } from 'lucide-react';
import { useAuthStore } from '@/lib/auth/store';
import { useAgents } from '@/lib/hooks/useAgents';
import { useTools } from '@/lib/hooks/useTools';
import { useUserProfile } from '@/lib/hooks/useUserProfile';
import { useWorlds } from '@/lib/hooks/useWorlds';
import { getProfileDisplayName } from '@/lib/shared/profile';
import { agentUrl, appsUrl, worldUrl } from '@/lib/shared/routes';
import type { RuntimeTimelineItem, WorldRuntimeRun, WorldSummary } from '@/lib/shared/types';

interface WorldDashboardDetail extends WorldSummary {
  worldState?: {
    latestRun?: WorldRuntimeRun;
    latestTick?: {
      tickId?: string;
      tickNumber?: number;
      costSpentStt?: number;
      remainingBalanceStt?: number;
      createdAt?: string;
    };
    runtime?: { status?: string };
  };
  live?: {
    subscriptions?: Array<{ status?: string }>;
    confirmedSubscriptions?: Array<{ status?: string }>;
    runs?: Array<{ status?: string; trigger_id?: string; created_at?: string; summary?: Record<string, unknown> }>;
    requests?: Array<{ status?: string; request_id?: string; created_at?: string; result?: Record<string, unknown> }>;
    timeline?: RuntimeTimelineItem[];
    aggregates?: {
      activeSubscriptionCount?: number;
      netSttSpent7d?: number;
    };
    latestActivityAt?: string | null;
    latestActivityKind?: string | null;
    latestActivitySummary?: string | null;
  };
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  useUserProfile();
  const { data: worlds = [] } = useWorlds();
  const { data: agents = [] } = useAgents();
  const { data: tools = [] } = useTools();
  const [worldDetails, setWorldDetails] = useState<WorldDashboardDetail[]>([]);
  const displayName = getProfileDisplayName(user);
  const runningWorlds = (worldDetails.length > 0 ? worldDetails : worlds).filter((world) => {
    const detail = world as WorldDashboardDetail;
    const runtimeStatus = detail.worldState?.runtime?.status ?? world.status;
    return runtimeStatus === 'armed' || runtimeStatus === 'running';
  });
  const activeTriggerCount = worldDetails.reduce((total, world) => {
    const subscribed = world.live?.aggregates?.activeSubscriptionCount
      ?? world.live?.confirmedSubscriptions?.filter((subscription) => subscription.status === 'active').length
      ?? 0;
    return total + subscribed;
  }, 0);
  // Disabled until net spend accounting is verified end to end. Keep runtime cost helpers wired for receipts/future accounting.
  // const sttSpent = worldDetails.reduce((total, world) => total + Number(world.live?.aggregates?.netSttSpent7d ?? 0), 0);
  const worldBalance = (worldDetails.length > 0 ? worldDetails : worlds).reduce((total, world) => {
    const value = Number.parseFloat(String(world.balance ?? '0').replace(/[^\d.]/g, ''));
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
  const recentWorlds = useMemo(() => worlds.slice(0, 4), [worlds]);
  const activity = worldDetails
    .flatMap((world) => (world.live?.timeline ?? []).slice(0, 10).map((item) => ({ ...item, worldName: world.name, world })))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 40);

  useEffect(() => {
    let cancelled = false;
    async function loadWorldDetails() {
      const details = await Promise.all(worlds.map(async (world) => {
        const app = await fetch(`/api/apps/${world.id}`).then((res) => res.json()).catch(() => null);
        const live = await fetch(`/api/apps/${world.id}/runtime/live`).then((res) => res.json()).catch(() => null);
        return app ? { ...app, live } : null;
      }));
      if (cancelled) return;
      setWorldDetails(details.filter((item): item is WorldDashboardDetail => Boolean(item?.id)));
    }
    void loadWorldDetails();
    return () => {
      cancelled = true;
    };
  }, [worlds]);

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold mb-2">Welcome Back, <span className="text-teal">{displayName}</span></h1>
          <p className="text-text-muted">Here is what is happening in your autonomous worlds.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Link href={appsUrl('/create')} className="px-4 py-2 bg-dream hover:bg-aurora text-void font-medium rounded-lg transition-colors flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New World
          </Link>
          <Link href={agentUrl(undefined, '/create')} className="px-4 py-2 border border-dream/30 hover:bg-dream/10 text-dream font-medium rounded-lg transition-colors flex items-center gap-2">
            <Bot className="w-4 h-4" />
            New Agent
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-10">
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 text-text-muted mb-3">
            <Globe className="w-5 h-5 text-teal" />
            <h3 className="font-medium">Active Worlds</h3>
          </div>
          <p className="text-3xl font-display font-bold">{runningWorlds.length}</p>
        </div>
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 text-text-muted mb-3">
            <Bot className="w-5 h-5 text-dream" />
            <h3 className="font-medium">Agents Deployed</h3>
          </div>
          <p className="text-3xl font-display font-bold">{agents.filter((agent) => agent.status === 'ACTIVE').length}</p>
        </div>
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 text-text-muted mb-3">
            <Wrench className="w-5 h-5 text-teal" />
            <h3 className="font-medium">Tools Deployed</h3>
          </div>
          <p className="text-3xl font-display font-bold">{tools.filter((tool) => tool.status === 'deployed').length}</p>
        </div>
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 text-text-muted mb-3">
            <Zap className="w-5 h-5 text-aurora" />
            <h3 className="font-medium">Active Triggers</h3>
          </div>
          <p className="text-3xl font-display font-bold">{activeTriggerCount}</p>
        </div>
        {/* Disabled until net spend accounting is verified end to end.
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 text-text-muted mb-3">
            <Activity className="w-5 h-5 text-text-primary" />
            <h3 className="font-medium">STT Spent (7d)</h3>
          </div>
          <p className="text-3xl font-display font-bold">{sttSpent.toFixed(3)}</p>
        </div>
        */}
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 text-text-muted mb-3">
            <Globe className="w-5 h-5 text-teal" />
            <h3 className="font-medium">World Balance</h3>
          </div>
          <p className="text-3xl font-display font-bold">{worldBalance.toFixed(3)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Worlds */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-display font-semibold">Your Worlds</h2>
            <Link href={appsUrl()} className="text-sm text-teal hover:text-aurora transition-colors">View All</Link>
          </div>
          
          {recentWorlds.map((world) => {
            const detail = worldDetails.find((item) => item.id === world.id);
            return (
              <div key={world.id} className="glass-panel p-5 glass-panel-hover flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center border border-dream/20">
                    <Globe className={`w-6 h-6 ${world.status === 'running' ? 'text-teal' : 'text-text-muted'}`} />
                  </div>
                  <div>
                    <h3 className="font-medium text-lg">{world.name}</h3>
                    <p className="text-sm text-text-muted">
                      {world.template} / Last result: {(() => {
                        const latestComplete = detail?.live?.timeline?.find((item) => ['WorkflowCompleted', 'ZoneUpdated', 'FactionMoraleUpdated', 'agent_request'].includes(item.kind) && item.status !== 'pending');
                        if (latestComplete?.summary) return latestComplete.summary;
                        if (detail?.worldState?.latestRun?.summary?.finalDecision) return String(detail.worldState.latestRun.summary.finalDecision);
                        if (detail?.worldState?.latestTick?.tickNumber) return `Tick ${detail.worldState.latestTick.tickNumber}`;
                        return 'No run yet';
                      })()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium ${
                    world.status === 'running' ? 'bg-teal/10 border-teal/20 text-teal' : 'bg-surface border-dream/20 text-text-muted'
                  }`}>
                    {world.status}
                  </div>
                  <Link href={worldUrl(world)} className="px-4 py-1.5 rounded-md border border-dream/30 text-sm hover:bg-dream/10 transition-colors">
                    Manage
                  </Link>
                </div>
              </div>
            );
          })}
          {recentWorlds.length === 0 && <div className="glass-panel p-5 text-sm text-text-muted">No worlds created yet.</div>}
        </div>

        {/* Recent Activity */}
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold mb-2">Activity Feed</h2>
          <div className="glass-panel p-5 h-[300px] overflow-y-auto">
            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-dream/50 before:to-transparent">
              {activity.map((item) => (
                <div key={`${item.worldId}:${item.id}`} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-5 h-5 rounded-full border border-void bg-dream text-void shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow">
                    <Zap className="w-3 h-3" />
                  </div>
                  <Link href={worldUrl(item.world)} className="w-[calc(100%-2.5rem)] md:w-[calc(50%-1.25rem)] p-3 rounded-lg border border-dream/20 bg-surface/50 text-sm hover:bg-dream/10">
                    <p className="font-medium break-words">{item.title}</p>
                    <p className="text-xs text-text-muted mt-1 break-words">{item.worldName} / {new Date(item.createdAt).toLocaleString()} / {item.status}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-text-muted break-words">{item.summary}</p>
                  </Link>
                </div>
              ))}
              {activity.length === 0 && <p className="text-sm text-text-muted">No runtime activity yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
