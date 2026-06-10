'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Bot, Database, GitBranch, Globe, Map, Shield, Trash2, Zap } from 'lucide-react';
import { getCachedValue, setCachedValue } from '@/lib/client/query-cache';
import { appsUrl, marketplaceUrl } from '@/lib/shared/routes';
import type { TemplateSummary } from '@/lib/shared/types';

export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.templateId as string;
  const [template, setTemplate] = useState<TemplateSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplate() {
      setLoading(true);
      const response = await fetch(`/api/templates/${templateId}`).then((res) => res.json()).catch(() => ({ template: null }));
      if (!cancelled) {
        setTemplate(response.template);
        if (response.template) setCachedValue(`template:${response.template.id}`, response.template);
        setLoading(false);
      }
    }
    void loadTemplate();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const deleteTemplate = async () => {
    if (!template || !window.confirm(`Delete template "${template.name}"? Worlds already created from it will not be deleted.`)) return;
    setDeleting(true);
    const response = await fetch(`/api/templates/${template.id}`, { method: 'DELETE' }).then((res) => res.json()).catch(() => ({ error: 'Unable to delete template.' }));
    if (response.error) {
      setMessage(response.error);
      setDeleting(false);
      return;
    }
    const current = getCachedValue<TemplateSummary[]>('templates') ?? [];
    setCachedValue('templates', current.filter((item) => item.id !== template.id));
    router.push(marketplaceUrl());
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto w-full glass-panel p-6 flex items-center gap-3 text-text-muted">
        <div className="w-5 h-5 border-2 border-dream/30 border-t-dream rounded-full animate-spin" />
        Loading template...
      </div>
    );
  }

  if (!template) {
    return (
      <div className="max-w-4xl mx-auto w-full glass-panel p-6">
        <Link href={marketplaceUrl()} className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to marketplace
        </Link>
        <p className="text-text-muted">Template not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      <Link href={marketplaceUrl()} className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft className="w-4 h-4" /> Back to marketplace
      </Link>

      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-dream/10 border border-dream/20 flex items-center justify-center">
          <Globe className="w-7 h-7 text-dream" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold">{template.name}</h1>
          <p className="text-text-muted">by {template.author} / {template.isPublic ? 'Public' : 'Private'}</p>
        </div>
      </div>
      {message && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{message}</div>}

      <div className="glass-panel p-6">
        <p className="text-text-muted leading-relaxed mb-6">{template.description}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {template.features.map((feature) => (
            <div key={feature} className="bg-void border border-dream/10 rounded-lg p-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-teal" /> {feature}
            </div>
          ))}
        </div>
      </div>

      {template.overview && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="glass-panel p-6">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2"><Map className="w-5 h-5 text-teal" /> Zones</h2>
            <div className="space-y-3">
              {template.overview.zones.map((zone) => (
                <div key={zone.id} className="rounded-lg border border-dream/10 bg-void/50 p-3">
                  <p className="font-medium">{zone.name}</p>
                  <p className="text-xs font-mono text-text-muted">{zone.id}</p>
                  {zone.description && <p className="mt-2 text-sm text-text-muted">{zone.description}</p>}
                </div>
              ))}
              {template.overview.zones.length === 0 && <p className="text-sm text-text-muted">No zones configured.</p>}
            </div>
          </section>

          <section className="glass-panel p-6">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-aurora" /> Factions</h2>
            <div className="space-y-3">
              {template.overview.factions.map((faction) => (
                <div key={faction.id} className="rounded-lg border border-dream/10 bg-void/50 p-3">
                  <p className="font-medium">{faction.name}</p>
                  <p className="text-xs font-mono text-text-muted">{faction.id}</p>
                  {faction.description && <p className="mt-2 text-sm text-text-muted">{faction.description}</p>}
                </div>
              ))}
              {template.overview.factions.length === 0 && <p className="text-sm text-text-muted">No factions configured.</p>}
            </div>
          </section>

          <section className="glass-panel p-6">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2"><Bot className="w-5 h-5 text-dream" /> Agent Chain</h2>
            <div className="space-y-3">
              {template.overview.agents.map((agent, index) => (
                <div key={`${agent.id}-${index}`} className="rounded-lg border border-dream/10 bg-void/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{agent.name}</p>
                    {agent.type && <span className="shrink-0 rounded-full border border-dream/20 px-2 py-0.5 text-[10px] font-mono text-dream">{agent.type}</span>}
                  </div>
                  <p className="text-xs font-mono text-text-muted">{agent.id}</p>
                  {agent.description && <p className="mt-2 text-sm text-text-muted">{agent.description}</p>}
                </div>
              ))}
              {template.overview.agents.length === 0 && <p className="text-sm text-text-muted">No template agents configured.</p>}
            </div>
          </section>

          <section className="glass-panel p-6">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2"><Database className="w-5 h-5 text-teal" /> Inputs & Data</h2>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Inputs</p>
                <div className="flex flex-wrap gap-2">
                  {template.overview.inputs.map((input) => <span key={input.id} className="rounded-full border border-dream/20 bg-void/50 px-3 py-1 text-xs">{input.label}</span>)}
                  {template.overview.inputs.length === 0 && <span className="text-sm text-text-muted">No inputs.</span>}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Data sources</p>
                <div className="space-y-2">
                  {template.overview.dataSources.map((source) => (
                    <div key={source.id} className="rounded-lg border border-dream/10 bg-void/50 p-3">
                      <p className="font-medium">{source.name}</p>
                      <p className="text-xs font-mono text-text-muted">{source.method ?? 'GET'} / {source.type ?? 'json'} / {source.id}</p>
                    </div>
                  ))}
                  {template.overview.dataSources.length === 0 && <p className="text-sm text-text-muted">No data sources.</p>}
                </div>
              </div>
            </div>
          </section>

          <section className="glass-panel p-6 lg:col-span-2">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2"><GitBranch className="w-5 h-5 text-dream" /> Trigger Flows</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {template.overview.triggers.map((trigger) => (
                <div key={trigger.id} className="rounded-lg border border-dream/10 bg-void/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{trigger.name}</p>
                      <p className="text-xs font-mono text-text-muted">{trigger.id}</p>
                    </div>
                    {trigger.type && <span className="rounded-full border border-teal/20 bg-teal/10 px-2 py-0.5 text-[10px] font-mono text-teal">{trigger.type}</span>}
                  </div>
                  <div className="mt-3 flex max-w-full items-center gap-2 overflow-x-auto pb-1 text-xs text-text-muted">
                    <span className="shrink-0 rounded border border-teal/20 bg-teal/10 px-2 py-1 text-teal">Trigger</span>
                    {trigger.agents.map((agentId) => (
                      <span key={`${trigger.id}-${agentId}`} className="contents">
                        <span className="shrink-0">-&gt;</span>
                        <span className="shrink-0 rounded border border-dream/20 bg-surface px-2 py-1 font-mono">{agentId}</span>
                      </span>
                    ))}
                    <span className="shrink-0">-&gt;</span>
                    <span className="shrink-0 rounded border border-aurora/20 bg-aurora/10 px-2 py-1 text-aurora">State update</span>
                  </div>
                </div>
              ))}
              {template.overview.triggers.length === 0 && <p className="text-sm text-text-muted">No trigger flows configured.</p>}
            </div>
          </section>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href={`${appsUrl('/create')}?template=${template.slug}`} className="inline-flex px-5 py-3 bg-teal text-void rounded-lg font-semibold">
          Use Template
        </Link>
        {template.isOwner && (
          <button onClick={deleteTemplate} disabled={deleting} className="inline-flex items-center gap-2 px-5 py-3 border border-red-500/30 text-red-300 rounded-lg font-semibold hover:bg-red-500/10 disabled:opacity-60">
            {deleting ? <div className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {deleting ? 'Deleting...' : 'Delete Template'}
          </button>
        )}
      </div>
    </div>
  );
}
