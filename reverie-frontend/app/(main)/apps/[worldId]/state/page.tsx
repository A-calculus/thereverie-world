'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowLeft, Database, ExternalLink, GitBranch, Globe, RefreshCw, Shield, Users, Zap } from 'lucide-react';
import { worldUrl } from '@/lib/shared/routes';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import { evmAddressUrl } from '@/lib/shared/explorer-links';

interface RuntimeLiveResponse {
  world?: {
    id: string;
    name: string;
    status: string;
    contractAddress?: string;
    balance?: string;
  };
  builder?: {
    triggers?: Array<{ id?: string; name?: string; type?: string; isActive?: boolean; agentChain?: string[] }>;
    agentChain?: Array<{ id?: string; agentId?: string; name?: string; zoneId?: string }>;
  };
  manifest?: {
    manifestHash?: string;
    zones?: Array<{ sourceId?: string; zoneId?: string; name?: string; allocationWeightBps?: string | number }>;
    factions?: Array<{ sourceId?: string; factionId?: string; name?: string; allocationWeightBps?: string | number }>;
    triggers?: Array<{ triggerId?: string; triggerType?: string | number; active?: boolean; schedule?: { cronExpression?: string; nextTimestampMs?: number; intervalSeconds?: number } }>;
    steps?: unknown[];
    relationships?: unknown[];
    unsupported?: string[];
  };
  liveManifestState?: {
    zones?: Array<Record<string, unknown>>;
    factions?: Array<Record<string, unknown>>;
  } | null;
  contract?: {
    address?: string;
    addressUrl?: string;
    hasCode?: boolean;
  } | null;
  rpcBalance?: {
    balanceWei?: string;
    balanceStt?: string;
  } | null;
  subscriptions?: Array<Record<string, unknown>>;
  runs?: Array<Record<string, unknown>>;
  requests?: Array<Record<string, unknown>>;
  latestRun?: Record<string, unknown> | null;
  live?: Record<string, unknown>;
  reconcileCheckpoint?: Record<string, unknown>;
  fundingWarnings?: Array<{ requestId?: string; message?: string; receiptUrl?: string }>;
  runtime?: Record<string, unknown>;
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function percentFromBps(value: unknown) {
  return Math.round(numberValue(value, 0) / 100);
}

function stableTime(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return 'Not recorded';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function shortId(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return 'unassigned';
  if (raw.length <= 18) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-6)}`;
}

function requestUrl(request: Record<string, unknown>) {
  return stringValue(request.receipt_url, stringValue(request.receiptUrl));
}

function transactionUrl(row: Record<string, unknown>) {
  return stringValue(row.explorer_url, stringValue(row.transactionUrl));
}

function receiptDetails(row: Record<string, unknown>) {
  const result = row.result && typeof row.result === 'object' && !Array.isArray(row.result) ? row.result as Record<string, unknown> : {};
  return result.receiptDetails && typeof result.receiptDetails === 'object' && !Array.isArray(result.receiptDetails)
    ? result.receiptDetails as Record<string, unknown>
    : {};
}

function DangerBar({ level }: { level: number }) {
  const width = Math.max(0, Math.min(100, level));
  const color = width >= 75 ? 'bg-red-400' : width >= 50 ? 'bg-yellow-400' : 'bg-teal';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-void rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{width}</span>
    </div>
  );
}

function StatusPill({ value }: { value: unknown }) {
  const status = stringValue(value, 'unknown');
  const tone = status === 'complete' || status === 'success' || status === 'active' || status === 'running'
    ? 'bg-teal/10 text-teal border-teal/20'
    : status === 'failed' || status === 'error' || status === 'insufficient_budget'
      ? 'bg-red-400/10 text-red-300 border-red-400/20'
      : 'bg-dream/10 text-dream border-dream/20';
  return <span className={`px-2 py-0.5 rounded-full border text-xs capitalize ${tone}`}>{status}</span>;
}

async function fetchRuntimeLive(worldId: string): Promise<RuntimeLiveResponse> {
  const response = await fetch(`/api/apps/${worldId}/runtime/live`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Unable to load live runtime state.');
  return data;
}

async function reconcileRuntime(worldId: string): Promise<RuntimeLiveResponse> {
  const response = await fetch(`/api/apps/${worldId}/runtime/reconcile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Unable to reconcile live runtime state.');
  return data;
}

export default function WorldStatePage() {
  const params = useParams();
  const worldId = params.worldId as string;
  const worldSlug = useWorldSlugFromHost();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['runtime-live', worldId],
    queryFn: () => fetchRuntimeLive(worldId),
    enabled: Boolean(worldId),
    staleTime: 15_000,
    retry: 1,
  });

  const reconcile = useMutation({
    mutationFn: () => reconcileRuntime(worldId),
    onSuccess: async (result) => {
      setMessage(`Reconciled ${numberValue((result as Record<string, unknown>).requestCount)} agent request(s) and ${numberValue((result as Record<string, unknown>).completedCount)} workflow completion(s).`);
      await queryClient.invalidateQueries({ queryKey: ['runtime-live', worldId] });
      await queryClient.invalidateQueries({ queryKey: ['world', worldId] });
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : 'Runtime reconciliation failed.');
    },
  });

  const zones = useMemo(() => {
    const manifestZones = data?.manifest?.zones ?? [];
    const liveZones = data?.liveManifestState?.zones ?? [];
    return manifestZones.map((zone) => {
      const live = liveZones.find((item) => stringValue(item.sourceId) === zone.sourceId || stringValue(item.zoneId) === zone.zoneId) ?? {};
      return {
        sourceId: stringValue(zone.sourceId, stringValue(live.sourceId, stringValue(zone.name, 'zone'))),
        compiledId: stringValue(zone.zoneId, stringValue(live.zoneId)),
        name: stringValue(live.name, stringValue(zone.name, stringValue(zone.sourceId, 'Zone'))),
        dangerLevel: numberValue(live.dangerLevel, 0),
        faction: stringValue(live.faction, 'unassigned'),
        climate: stringValue(live.climate, 'not recorded'),
        latestDecision: stringValue(live.latestDecision, 'pending'),
        narrative: stringValue(live.narrative, 'No zone movement has been reconciled yet.'),
        active: live.active === undefined ? true : Boolean(live.active),
        allocationPercent: percentFromBps(live.allocationWeightBps ?? zone.allocationWeightBps),
      };
    });
  }, [data?.liveManifestState?.zones, data?.manifest?.zones]);

  const factions = useMemo(() => {
    const manifestFactions = data?.manifest?.factions ?? [];
    const liveFactions = data?.liveManifestState?.factions ?? [];
    return manifestFactions.map((faction) => {
      const live = liveFactions.find((item) => stringValue(item.sourceId) === faction.sourceId || stringValue(item.factionId) === faction.factionId) ?? {};
      return {
        sourceId: stringValue(faction.sourceId, stringValue(live.sourceId, stringValue(faction.name, 'faction'))),
        compiledId: stringValue(faction.factionId, stringValue(live.factionId)),
        name: stringValue(live.name, stringValue(faction.name, stringValue(faction.sourceId, 'Faction'))),
        morale: numberValue(live.morale, 0),
        latestDecision: stringValue(live.latestDecision, 'pending'),
        narrative: stringValue(live.narrative, 'No narrative update has been reconciled yet.'),
        allocationPercent: percentFromBps(live.allocationWeightBps ?? faction.allocationWeightBps),
      };
    });
  }, [data?.liveManifestState?.factions, data?.manifest?.factions]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-dream/30 border-t-dream rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !data?.world) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
        <AlertTriangle className="w-10 h-10 text-yellow-400" />
        <p>{error instanceof Error ? error.message : 'Unable to load world state. Deploy the world and connect your wallet.'}</p>
      </div>
    );
  }

  const world = data.world;
  const contractAddress = world.contractAddress ?? data.contract?.address ?? '';
  const contractUrl = data.contract?.addressUrl ?? (contractAddress ? evmAddressUrl(contractAddress) : '');
  const subscriptions = (data.subscriptions ?? []).filter((row) => (
    stringValue(row.status, 'active') === 'active' &&
    (Boolean(stringValue(row.subscription_id)) || Boolean(stringValue(row.subscribe_tx_hash)))
  ));
  const runs = data.runs ?? [];
  const requests = data.requests ?? [];
  const activeSubscriptions = subscriptions.length;
  const requestStatus = (row: Record<string, unknown>) => stringValue(receiptDetails(row).status, stringValue(row.status, stringValue(row.callback_status, 'pending')));
  const failedRequests = requests.filter((row) => ['failed', 'error', 'insufficient_budget'].includes(requestStatus(row))).length;
  const pendingRequests = requests.filter((row) => !['complete', 'success', 'failed', 'error', 'insufficient_budget'].includes(requestStatus(row))).length;

  return (
    <div className="max-w-7xl mx-auto w-full space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <Link href={worldUrl({ id: worldId, name: world.name, slug: worldSlug })} className="mb-4 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
            <ArrowLeft className="w-4 h-4" /> Back to world
          </Link>
          <h1 className="text-3xl font-display font-bold mb-1">Live World State</h1>
          <p className="text-text-muted">RPC and reconciled state for {world.name}.</p>
          {contractAddress && (
            <a href={contractUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-xs text-dream font-mono break-all hover:text-teal">
              {contractAddress} <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => reconcile.mutate()}
            disabled={reconcile.isPending || !contractAddress}
            className="px-4 py-2 bg-teal text-void rounded-lg inline-flex items-center justify-center gap-2 font-semibold disabled:opacity-60"
          >
            {reconcile.isPending ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reconcile
          </button>
        </div>
      </div>

      {(message || reconcile.isPending) && (
        <div className="glass-panel p-4 text-sm text-text-muted">
          <p>{reconcile.isPending ? 'Scanning bounded contract logs, refreshing RPC balance, and syncing missing receipt/run.' : message}</p>
        </div>
      )}

      {(data.fundingWarnings ?? []).length > 0 && (
        <div className="rounded-lg border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-100">
          <p className="font-medium mb-2">Funding warning</p>
          {(data.fundingWarnings ?? []).map((warning, index) => (
            <p key={`${warning.requestId ?? index}`} className="break-words">
              Request {shortId(warning.requestId)}: {warning.message ?? 'Native agent execution needs more budget.'}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="glass-panel p-5">
          <div className="flex items-center gap-2 text-text-muted mb-2">
            <Database className="w-4 h-4 text-teal" />
            <span className="text-sm">RPC Balance</span>
          </div>
          <p className="text-2xl font-display font-bold">{data.rpcBalance?.balanceStt ?? world.balance ?? '0'} STT</p>
          <p className="text-xs text-text-muted mt-1 font-mono break-all">{data.rpcBalance?.balanceWei ?? 'No RPC balance yet'} wei</p>
        </div>
        <div className="glass-panel p-5">
          <div className="flex items-center gap-2 text-text-muted mb-2">
            <Shield className="w-4 h-4 text-dream" />
            <span className="text-sm">Contract Code</span>
          </div>
          <p className="text-2xl font-display font-bold">{data.contract?.hasCode ? 'Verified' : 'Missing'}</p>
          <p className="text-xs text-text-muted mt-1">Checked with RPC, not explorer indexing.</p>
        </div>
        <div className="glass-panel p-5">
          <div className="flex items-center gap-2 text-text-muted mb-2">
            <Zap className="w-4 h-4 text-aurora" />
            <span className="text-sm">Subscriptions</span>
          </div>
          <p className="text-2xl font-display font-bold">{activeSubscriptions}</p>
          <p className="text-xs text-text-muted mt-1">{data.manifest?.triggers?.length ?? 0} compiled trigger(s)</p>
        </div>
        <div className="glass-panel p-5">
          <div className="flex items-center gap-2 text-text-muted mb-2">
            <Activity className="w-4 h-4 text-teal" />
            <span className="text-sm">Agent Requests</span>
          </div>
          <p className="text-2xl font-display font-bold">{requests.length}</p>
          <p className="text-xs text-text-muted mt-1">{pendingRequests} pending, {failedRequests} failed/error</p>
        </div>
      </div>

      <section className="glass-panel p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-display font-semibold">Compiled Manifest</h2>
            <p className="text-sm text-text-muted">Deterministic IDs and allocation relationships compiled from the builder before deployment.</p>
          </div>
          <span className="text-xs font-mono text-dream break-all">{data.manifest?.manifestHash ?? 'No manifest hash recorded'}</span>
        </div>
        {Object.keys(data.reconcileCheckpoint ?? {}).length > 0 && (
          <div className="rounded-lg border border-dream/10 bg-void/50 p-3 text-xs text-text-muted">
            Reconcile checkpoint: scanned to block <span className="font-mono text-dream">{stringValue(data.reconcileCheckpoint?.scannedToBlock, 'unknown')}</span>
            {data.reconcileCheckpoint?.complete ? ' and caught up to latest.' : `; next scan starts at ${stringValue(data.reconcileCheckpoint?.nextFromBlock, 'unknown')}.`}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div className="bg-void/50 border border-dream/10 rounded-lg p-3"><span className="block text-text-muted text-xs">Zones</span>{data.manifest?.zones?.length ?? 0}</div>
          <div className="bg-void/50 border border-dream/10 rounded-lg p-3"><span className="block text-text-muted text-xs">Factions</span>{data.manifest?.factions?.length ?? 0}</div>
          <div className="bg-void/50 border border-dream/10 rounded-lg p-3"><span className="block text-text-muted text-xs">Triggers</span>{data.manifest?.triggers?.length ?? 0}</div>
          <div className="bg-void/50 border border-dream/10 rounded-lg p-3"><span className="block text-text-muted text-xs">Steps</span>{data.manifest?.steps?.length ?? 0}</div>
          <div className="bg-void/50 border border-dream/10 rounded-lg p-3"><span className="block text-text-muted text-xs">Allocations</span>{data.manifest?.relationships?.length ?? 0}</div>
        </div>
        {(data.manifest?.unsupported ?? []).length > 0 && (
          <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/10 p-3 text-sm text-yellow-100">
            {(data.manifest?.unsupported ?? []).map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <section className="glass-panel p-6">
          <h2 className="text-lg font-display font-semibold mb-5 flex items-center gap-2">
            <Globe className="w-5 h-5 text-dream" /> Zones
          </h2>
          <div className="space-y-5">
            {zones.map((zone) => (
              <div key={zone.compiledId || zone.sourceId} className="p-4 bg-void/50 rounded-lg border border-dream/10">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-medium">{zone.name}</h3>
                    <p className="text-xs text-text-muted font-mono break-all">{zone.compiledId || 'No compiled ID'}</p>
                  </div>
                  <div className="text-right">
                    <StatusPill value={zone.active ? 'active' : 'inactive'} />
                    <p className="text-xs text-text-muted mt-1">{zone.allocationPercent}% allocation</p>
                  </div>
                </div>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="flex items-center justify-between text-text-muted mb-1">
                      <span>Danger Level</span>
                      <span>Controller: {shortId(zone.faction)}</span>
                    </div>
                    <DangerBar level={zone.dangerLevel} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-text-muted">Climate</span>
                    <span className="text-aurora text-xs text-right">{zone.climate}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-text-muted">Latest decision</span>
                    <span className="text-xs text-right break-words">{zone.latestDecision}</span>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed break-words">{zone.narrative}</p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-text-muted">Attached agents</span>
                    <span className="text-xs text-right">{(data.builder?.agentChain ?? []).filter((agent) => agent.zoneId === zone.sourceId).length}</span>
                  </div>
                </div>
              </div>
            ))}
            {zones.length === 0 && <p className="text-sm text-text-muted">No manifest zones have been compiled for this world yet.</p>}
          </div>
        </section>

        <section className="glass-panel p-6">
          <h2 className="text-lg font-display font-semibold mb-5 flex items-center gap-2">
            <Users className="w-5 h-5 text-aurora" /> Factions
          </h2>
          <div className="space-y-4">
            {factions.map((faction) => (
              <div key={faction.compiledId || faction.sourceId} className="p-4 bg-void/50 rounded-lg border border-dream/10">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-medium">{faction.name}</h3>
                    <p className="text-xs text-text-muted font-mono break-all">{faction.compiledId || faction.sourceId}</p>
                  </div>
                  <span className="text-xs text-text-muted">{faction.allocationPercent}% allocation</span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Morale</span>
                    <span className={faction.morale >= 70 ? 'text-teal' : faction.morale >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                      {faction.morale}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-void rounded-full overflow-hidden">
                    <div
                      className={`h-full ${faction.morale >= 70 ? 'bg-teal' : faction.morale >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                      style={{ width: `${Math.max(0, Math.min(100, faction.morale))}%` }}
                    />
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed">{faction.narrative}</p>
                  <p className="text-xs text-aurora break-words">Decision: {faction.latestDecision}</p>
                </div>
              </div>
            ))}
            {factions.length === 0 && <p className="text-sm text-text-muted">No manifest factions have been compiled for this world yet.</p>}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="glass-panel p-5">
          <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-dream" /> Subscriptions
          </h2>
          <div className="space-y-3">
            {subscriptions.slice(0, 8).map((row, index) => (
              <div key={`${stringValue(row.subscription_id, String(index))}-${index}`} className="rounded-lg border border-dream/10 bg-void/50 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-dream">{shortId(row.subscription_id ?? row.trigger_id)}</span>
                  <StatusPill value={row.status ?? 'active'} />
                </div>
                <p className="text-xs text-text-muted mt-1">Trigger {shortId(row.trigger_id)}</p>
                {transactionUrl(row) && (
                  <a href={transactionUrl(row)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-teal hover:text-aurora">
                    View transaction <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
            {subscriptions.length === 0 && <p className="text-sm text-text-muted">No on-chain subscriptions recorded yet.</p>}
          </div>
        </section>

        <section className="glass-panel p-5">
          <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-teal" /> Runtime Runs
          </h2>
          <div className="space-y-3">
            {runs.slice(0, 8).map((row, index) => (
              <div key={`${stringValue(row.id, String(index))}-${index}`} className="rounded-lg border border-dream/10 bg-void/50 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium min-w-0 break-all">{stringValue(row.trigger_id, 'Runtime run')}</span>
                  <StatusPill value={row.status ?? 'pending'} />
                </div>
                <p className="text-xs text-text-muted mt-1">{stableTime(row.created_at)}</p>
                {transactionUrl(row) && (
                  <a href={transactionUrl(row)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-teal hover:text-aurora">
                    View transaction <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
            {runs.length === 0 && <p className="text-sm text-text-muted">No runtime runs have been submitted or reconciled yet.</p>}
          </div>
        </section>

        <section className="glass-panel p-5">
          <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-aurora" /> Agent Receipts
          </h2>
          <div className="space-y-3">
            {requests.slice(0, 8).map((row, index) => (
              <div key={`${stringValue(row.request_id, String(index))}-${index}`} className="rounded-lg border border-dream/10 bg-void/50 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-dream break-all">{shortId(row.request_id)}</span>
                  <StatusPill value={receiptDetails(row).status ?? row.status ?? row.callback_status ?? 'pending'} />
                </div>
                <p className="text-xs text-text-muted mt-1 break-words">{stringValue(row.agent_kind, 'native agent')}</p>
                {stringValue(receiptDetails(row).errorMessage) && (
                  <p className="mt-2 rounded border border-red-400/20 bg-red-400/10 p-2 text-xs text-red-100 break-words">
                    {stringValue(receiptDetails(row).errorMessage)}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 mt-2">
                  {requestUrl(row) && (
                    <a href={requestUrl(row)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal hover:text-aurora">
                      View receipt <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {transactionUrl(row) && (
                    <a href={transactionUrl(row)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-dream hover:text-teal">
                      EVM tx <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
            {requests.length === 0 && <p className="text-sm text-text-muted">No native agent requests have been recorded yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
