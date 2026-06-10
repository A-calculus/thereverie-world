'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, Bot, Zap, Shield, FileText, Database, GitBranch, Wallet, Rocket, Activity } from 'lucide-react';
import { worldUrl } from '@/lib/shared/routes';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import type { EventLog, RuntimeTimelineItem } from '@/lib/shared/types';

type ReceiptView = {
  requestId?: string;
  status?: string;
  errorMessage?: string;
  explorerUrl?: string;
  requestDetails?: Record<string, unknown>;
  receipts?: Array<{
    url?: string;
    status?: string;
    agentRunnerAddress?: string;
    runnerVersion?: string;
    errorMessage?: string;
    steps?: unknown[];
  }>;
  count?: number;
};

export default function EventsPage() {
  const params = useParams();
  const worldId = params.worldId as string;
  const worldSlug = useWorldSlugFromHost();
  const [events, setEvents] = useState<EventLog[]>([]);
  const [timeline, setTimeline] = useState<RuntimeTimelineItem[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [receiptDetails, setReceiptDetails] = useState<ReceiptView | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  const [worldLabel, setWorldLabel] = useState(worldSlug || worldId);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventMessage, setEventMessage] = useState('Loading persisted world events...');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/apps/${worldId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const builderSlug = typeof data?.worldState?.builder?.uiSlug === 'string' ? data.worldState.builder.uiSlug : '';
        const name = typeof data?.name === 'string' ? data.name : '';
        setWorldLabel(worldSlug || builderSlug || name || worldId);
      })
      .catch(() => setWorldLabel(worldSlug || worldId));
    return () => {
      cancelled = true;
    };
  }, [worldId, worldSlug]);

  useEffect(() => {
    let cancelled = false;
    async function loadEvents(showLoading: boolean) {
      if (showLoading) {
        setLoadingEvents(true);
        setEventMessage('Loading persisted world events...');
      }
      try {
        const data = await fetch(`/api/apps/${worldId}/events`).then((res) => res.json());
        if (cancelled) return;
        if (data.error) {
          setEventMessage(data.error);
          setEvents([]);
        } else {
          setEvents(Array.isArray(data.events) ? data.events : []);
          setTimeline(Array.isArray(data.timeline) ? data.timeline : []);
          setEventMessage(data.source === 'demo' ? 'Demo event fallback is active because the database runtime is unavailable.' : 'No persisted events have been recorded for this world yet.');
        }
      } catch {
        if (!cancelled) {
          setEvents([]);
          setTimeline([]);
          setEventMessage('Unable to load world events.');
        }
      } finally {
        if (!cancelled && showLoading) setLoadingEvents(false);
      }
    }
    Promise.resolve().then(() => {
      if (!cancelled) void loadEvents(true);
    });
    const interval = window.setInterval(() => void loadEvents(false), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [worldId]);

  const openReceipt = async (receiptId: string) => {
    setSelectedReceipt(receiptId);
    setReceiptDetails(null);
    setReceiptLoading(true);
    setReceiptError('');
    fetch(`/api/receipts/${receiptId}`)
      .then((res) => res.json())
      .then((data) => {
        setReceiptDetails(data.receipt ?? null);
        setReceiptError(data.error ?? '');
      })
      .catch((error) => {
        setReceiptError(error instanceof Error ? error.message : 'Unable to load receipt details.');
      })
      .finally(() => {
        setReceiptLoading(false);
      });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'deployment': return <Rocket className="w-5 h-5 text-dream" />;
      case 'subscription': return <GitBranch className="w-5 h-5 text-teal" />;
      case 'runtime_run': return <Activity className="w-5 h-5 text-aurora" />;
      case 'balance_snapshot': return <Wallet className="w-5 h-5 text-teal" />;
      case 'agent_request': return <Bot className="w-5 h-5 text-aurora" />;
      case 'WorkflowStepRequested': return <Zap className="w-5 h-5 text-yellow-400" />;
      case 'WorkflowCompleted': return <Shield className="w-5 h-5 text-teal" />;
      case 'ZoneUpdated': return <Database className="w-5 h-5 text-dream" />;
      case 'FactionMoraleUpdated': return <Shield className="w-5 h-5 text-aurora" />;
      case 'agent_decision': return <Bot className="w-5 h-5 text-aurora" />;
      case 'chronicle_entry': return <FileText className="w-5 h-5 text-teal" />;
      case 'zone_updated': return <Database className="w-5 h-5 text-dream" />;
      case 'trigger_fired': return <Zap className="w-5 h-5 text-yellow-400" />;
      default: return <Shield className="w-5 h-5 text-text-muted" />;
    }
  };

  const statusTone = (severity: RuntimeTimelineItem['severity']) => {
    if (severity === 'error') return 'border-red-400/25 bg-red-400/10 text-red-200';
    if (severity === 'warning') return 'border-yellow-400/25 bg-yellow-400/10 text-yellow-100';
    if (severity === 'success') return 'border-teal/25 bg-teal/10 text-teal';
    return 'border-dream/20 bg-dream/10 text-dream';
  };

  const displayTimeline: RuntimeTimelineItem[] = timeline.length > 0
    ? timeline
    : events.map((event) => ({
        id: event.id,
        worldId: event.worldId,
        kind: event.type,
        status: 'success',
        severity: 'success' as const,
        createdAt: event.timestamp,
        title: event.title,
        summary: event.description,
        transactionHash: event.transactionHash,
        requestId: event.receiptId,
        receiptUrl: event.receiptId ? `https://agents.testnet.somnia.network/receipts/${event.receiptId}` : undefined,
        costStt: event.cost ? Number(event.cost.replace(/[^\d.]/g, '')) : undefined,
        details: event as unknown as Record<string, unknown>,
        raw: event,
      }));

  return (
    <div className="max-w-5xl mx-auto w-full flex flex-col md:flex-row gap-8">
      <div className="flex-1">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Link href={worldUrl({ id: worldId, slug: worldSlug })} className="mb-4 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
              <ArrowLeft className="w-4 h-4" /> Back to world
            </Link>
            <h1 className="text-3xl font-display font-bold mb-1">Live Event Stream</h1>
            <p className="text-text-muted">Live runtime monitor for <strong className="text-text-primary">{worldLabel}</strong> world.</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal/10 border border-teal/20 text-teal text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
            Live Connection
          </div>
        </div>

        <div className="space-y-4">
          {loadingEvents && (
            <div className="glass-panel p-5 flex items-center gap-3 text-text-muted">
              <div className="w-5 h-5 border-2 border-dream/30 border-t-dream rounded-full animate-spin" />
              Loading events...
            </div>
          )}
          {!loadingEvents && displayTimeline.length === 0 && (
            <div className="glass-panel p-5 text-text-muted">
              {eventMessage}
            </div>
          )}
          {displayTimeline.map((event, i) => (
            <div 
              key={event.id}
              style={{ animationDelay: `${i * 0.1}s` }}
              className="glass-panel p-5 animate-in fade-in slide-in-from-bottom-4 flex gap-4 items-start"
            >
              <div className="w-10 h-10 rounded-full bg-surface border border-dream/20 flex items-center justify-center shrink-0 mt-1 shadow-inner">
                {getIcon(event.kind)}
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-medium text-lg">{event.title}</h3>
                  <span className="text-xs text-text-muted whitespace-nowrap ml-4">
                    {new Date(event.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-text-muted text-sm mb-3 break-words">{event.summary}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full border px-2 py-0.5 capitalize ${statusTone(event.severity)}`}>{event.status}</span>
                  <span className="rounded-full border border-dream/10 bg-void/50 px-2 py-0.5 text-text-muted">{event.kind}</span>
                  {event.triggerId && <span className="rounded-full border border-dream/10 bg-void/50 px-2 py-0.5 text-text-muted font-mono break-all">Trigger {event.triggerId.slice(0, 10)}...</span>}
                  {event.stepIndex !== undefined && <span className="rounded-full border border-dream/10 bg-void/50 px-2 py-0.5 text-text-muted">Step {event.stepIndex}</span>}
                  {event.agentKind && <span className="rounded-full border border-dream/10 bg-void/50 px-2 py-0.5 text-text-muted">{event.agentKind}</span>}
                </div>
                
                {Boolean(event.receiptUrl || event.transactionUrl || event.costStt !== undefined || event.details || event.raw) && (
                  <div className="space-y-3 mt-4 pt-3 border-t border-dream/10">
                    <div className="flex flex-wrap items-center gap-4">
                    {event.costStt !== undefined && (
                      <span className="text-xs font-mono text-text-muted">Net cost: {event.costStt.toFixed(6)} STT</span>
                    )}
                    {event.transactionUrl && (
                      <a href={event.transactionUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-dream hover:text-teal font-medium flex items-center gap-1 transition-colors">
                        View transaction <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {event.receiptUrl && (
                    <button 
                      onClick={() => void openReceipt(event.requestId ?? event.receiptUrl!.split('/').pop() ?? '')}
                      className="text-xs text-teal hover:text-aurora font-medium flex items-center gap-1 transition-colors"
                    >
                      View Proof-of-Thought <ExternalLink className="w-3 h-3" />
                    </button>
                    )}
                    </div>
                    <details className="rounded border border-dream/10 bg-void/50 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-text-muted">Raw timeline details</summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-text-muted">{JSON.stringify(event.details ?? event.raw ?? {}, null, 2)}</pre>
                    </details>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-3xl p-6 border-aurora/30 max-h-[calc(100vh-2rem)] overflow-y-auto overflow-x-hidden animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display font-bold text-lg">Receipt Details</h3>
              <button 
                onClick={() => {
                  setSelectedReceipt(null);
                  setReceiptDetails(null);
                  setReceiptError('');
                }}
                className="text-text-muted hover:text-text-primary"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4 text-sm">
              {receiptLoading && (
                <div className="flex items-center gap-2 text-text-muted">
                  <div className="w-4 h-4 border-2 border-dream/30 border-t-dream rounded-full animate-spin" />
                  Loading live receipt...
                </div>
              )}
              {receiptError && (
                <div className="rounded border border-yellow-400/25 bg-yellow-400/10 p-3 text-xs text-yellow-200 break-words">
                  {receiptError}
                </div>
              )}
              <div>
                <p className="text-text-muted mb-1 text-xs uppercase tracking-wider">Receipt Status</p>
                <div className={`flex items-center gap-2 font-medium ${receiptDetails?.status === 'success' ? 'text-teal' : receiptDetails?.status && receiptDetails.status !== 'pending' ? 'text-red-300' : 'text-dream'}`}>
                  <Shield className="w-4 h-4" /> {receiptDetails?.status ?? 'pending'}
                </div>
                {receiptDetails?.errorMessage && <p className="mt-2 text-xs text-red-300 break-words">{receiptDetails.errorMessage}</p>}
              </div>
              
              <div>
                <p className="text-text-muted mb-1 text-xs uppercase tracking-wider">Agent Request</p>
                <div className="max-h-56 max-w-full overflow-auto font-mono bg-void p-2 rounded border border-dream/20 text-xs text-dream whitespace-pre-wrap break-words">
                  {JSON.stringify(receiptDetails?.requestDetails ?? { requestId: selectedReceipt }, null, 2)}
                </div>
              </div>

              <div>
                <p className="text-text-muted mb-1 text-xs uppercase tracking-wider">Validator Receipts</p>
                <ul className="space-y-2 font-mono text-xs text-text-muted">
                  {(receiptDetails?.receipts ?? []).map((receipt, index) => (
                    <li key={`${receipt.url ?? index}`} className="min-w-0 rounded border border-dream/10 bg-void/50 p-2">
                      <div className="flex min-w-0 justify-between gap-2">
                        <span className="min-w-0 truncate">{receipt.agentRunnerAddress ?? `Receipt ${index + 1}`}</span>
                        <span className={receipt.status === 'success' ? 'text-teal' : receipt.status ? 'text-red-300' : 'text-text-muted'}>{receipt.status ?? 'unknown'}</span>
                      </div>
                      {receipt.errorMessage && <p className="mt-1 whitespace-normal break-words text-red-300">{receipt.errorMessage}</p>}
                      {receipt.url && <a href={receipt.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex text-teal">Raw JSON</a>}
                    </li>
                  ))}
                  {!receiptLoading && (receiptDetails?.receipts ?? []).length === 0 && (
                    <li className="text-text-muted">No validator receipt JSON was returned yet.</li>
                  )}
                </ul>
              </div>

              <div className="pt-4 mt-4 border-t border-dream/20">
                <a 
                  href={receiptDetails?.explorerUrl ?? `https://agents.testnet.somnia.network/receipts/${selectedReceipt}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2 bg-surface hover:bg-dream/20 border border-dream/30 rounded flex items-center justify-center gap-2 transition-colors text-text-primary font-medium"
                >
                  Verify on Explorer
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
