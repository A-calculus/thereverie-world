'use client';

import Link from 'next/link';
import { Bot, Download, Globe, Shield, Trash2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { flushClientCacheToServer, getCachedValue, mergePendingLocalById, setCachedValue } from '@/lib/client/query-cache';
import { useAgents } from '@/lib/hooks/useAgents';
import { demoTemplates } from '@/lib/shared/demo-data';
import { agentUrl, appsUrl, marketplaceUrl } from '@/lib/shared/routes';
import type { TemplateSummary } from '@/lib/shared/types';

export default function TemplatesPage() {
  const [filter, setFilter] = useState('All Templates');
  const [templateList, setTemplateList] = useState<TemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const { data: agents = [] } = useAgents();
  const filters = [
    'All Templates',
    'Official',
    'DeFi',
    'Gaming',
    'Social Tokens',
    'AI NFTs',
    'DAO',
    'Prediction Markets',
    'Insurance',
    'Supply Chain',
    'Virtual Worlds',
  ];
  const templates = useMemo(() => {
    if (filter === 'All Templates' || filter === 'Official') return templateList;
    const normalized = filter.toLowerCase().replace(/\s+/g, '_');
    return templateList.filter((template) => (
      template.category.includes(normalized) ||
      template.tags.some((tag) => tag.toLowerCase().includes(filter.toLowerCase()))
    ));
  }, [filter, templateList]);
  const marketplaceAgents = useMemo(() => (
    agents.filter((agent) => agent.isOfficial || agent.isPublic)
  ), [agents]);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplates() {
      await flushClientCacheToServer();
      const cached = getCachedValue<TemplateSummary[]>('templates');
      const response = await fetch('/api/templates').then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? 'Unable to load marketplace templates.');
        return data;
      }).catch((error) => ({ error: error instanceof Error ? error.message : 'Unable to load marketplace templates.' }));
      if (cancelled) return;
      if (response.error) {
        setTemplateError(response.error);
        setTemplatesLoading(false);
        return;
      }
      const upstream = Array.isArray(response.templates)
        ? response.templates as TemplateSummary[]
        : response.source === 'demo'
          ? demoTemplates
          : [];
      const merged = mergePendingLocalById('templates', cached, upstream);
      setCachedValue('templates', merged);
      for (const template of merged) setCachedValue(`template:${template.id}`, template);
      setTemplateList(merged);
      setTemplateError(null);
      setTemplatesLoading(false);
    }
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  const deleteTemplate = async (template: TemplateSummary) => {
    if (!window.confirm(`Delete template "${template.name}"? Worlds already created from it will not be deleted.`)) return;
    setDeletingTemplateId(template.id);
    const response = await fetch(`/api/templates/${template.id}`, { method: 'DELETE' }).then((res) => res.json()).catch(() => ({ error: 'Unable to delete template.' }));
    if (response.error) {
      setTemplateError(response.error);
      setDeletingTemplateId(null);
      return;
    }
    setTemplateList((current) => {
      const next = current.filter((item) => item.id !== template.id);
      setCachedValue('templates', next);
      return next;
    });
    setDeletingTemplateId(null);
  };

  const styleFor = (id: string) => {
    if (id === 'fantasy') return { color: 'text-teal', bg: 'bg-teal/10', border: 'border-teal/20' };
    if (id === 'cyberpunk') return { color: 'text-aurora', bg: 'bg-aurora/10', border: 'border-aurora/20' };
    return { color: 'text-dream', bg: 'bg-dream/10', border: 'border-dream/20' };
  };

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-2">Marketplace</h1>
        <p className="text-text-muted">Browse reusable agents and templates. Public assets are copied before users edit them.</p>
      </div>

      <section className="mb-10">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-display font-semibold">Agents</h2>
            <p className="text-sm text-text-muted">Official agents and public user agents can be copied into a user-owned version before editing.</p>
          </div>
          <Link href={agentUrl(undefined, '/create')} className="px-4 py-2 border border-dream/30 rounded-lg text-sm text-dream hover:bg-dream/10">
            Create Agent
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {marketplaceAgents.map((agent) => (
            <div key={agent.id} className="glass-panel p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-lg bg-dream/10 border border-dream/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-dream" />
                </div>
                <span suppressHydrationWarning className="rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider border-dream/20 bg-surface text-text-muted">
                  {agent.status}
                </span>
              </div>
              <h3 className="font-display text-lg font-semibold">{agent.name}</h3>
              <p className="mt-1 text-xs text-text-muted">{agent.isOfficial ? 'REVERIE Official' : agent.isOwner ? 'Your Agent' : 'Community Agent'}</p>
              <p className="mt-3 text-sm text-text-muted flex-1">{agent.description}</p>
              <Link href={agent.isOwner && !agent.isOfficial ? agentUrl(agent.id) : agentUrl(agent.id, '/edit')} className="mt-5 w-full py-2 border border-dream/30 rounded-lg text-sm font-medium flex items-center justify-center hover:bg-dream/10">
                {agent.isOwner && !agent.isOfficial ? 'View Agent' : 'Copy & Edit'}
              </Link>
            </div>
          ))}
          {marketplaceAgents.length === 0 && (
            <div className="glass-panel p-5 text-sm text-text-muted">No marketplace agents are available yet.</div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-display font-semibold">Templates</h2>
          <p className="text-sm text-text-muted">Use official or user-owned templates to create a new world copy.</p>
        </div>

      <div className="flex gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide">
        {filters.map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`px-4 py-1.5 rounded-full border text-sm font-medium whitespace-nowrap transition-colors ${filter === item ? 'bg-dream/20 border-dream/30 text-dream' : 'bg-surface border-dream/20 text-text-muted hover:text-text-primary'}`}
          >
            {item}
          </button>
        ))}
      </div>

      {templatesLoading && (
        <div className="glass-panel p-6 text-sm text-text-muted flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-dream/30 border-t-dream rounded-full animate-spin" />
          Loading marketplace templates...
        </div>
      )}

      {!templatesLoading && templateError && (
        <div className="glass-panel p-6 text-sm text-red-300 border-red-400/20">
          {templateError}
        </div>
      )}

      {!templatesLoading && !templateError && templates.length === 0 && (
        <div className="glass-panel p-6 text-sm text-text-muted">
          No marketplace templates are available yet.
        </div>
      )}

      {!templatesLoading && !templateError && templates.length > 0 && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {templates.map(t => {
          const style = styleFor(t.id);
          return (
          <div key={t.id} className="glass-panel p-6 flex flex-col h-full relative overflow-hidden group">
            {/* Background glow */}
            <div className={`absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl opacity-20 ${style.bg}`} />
            
            <div className="flex items-start justify-between mb-4 relative z-10">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${style.bg} ${style.border}`}>
                <Globe className={`w-6 h-6 ${style.color}`} />
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted bg-surface px-2.5 py-1 rounded-full border border-dream/20">
                <Download className="w-3 h-3" />
                {t.downloads}
              </div>
            </div>

            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-xl font-display font-bold">{t.name}</h3>
                <Shield className="w-4 h-4 text-teal" />
              </div>
              <p className="text-xs text-text-muted mb-4">by {t.author}</p>
              {t.isOwner && (
                <p className="mb-3 inline-flex rounded-full border border-dream/20 bg-void/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                  {t.isPublic ? 'Public' : 'Private'}
                </p>
              )}
              
              <div className="flex flex-wrap gap-2 mb-4">
                {t.tags.map(tag => (
                  <span key={tag} className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded border border-dream/20 bg-void/50 text-text-primary">
                    {tag}
                  </span>
                ))}
              </div>

              <p className="text-sm text-text-muted mb-6 leading-relaxed flex-1">
                {t.description}
              </p>

              <div className="space-y-2 mb-6">
                {t.features.map(f => (
                  <div key={f} className="flex items-center gap-2 text-sm">
                    <Zap className={`w-3 h-3 ${style.color}`} />
                    {f}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-auto relative z-10">
              <Link 
                href={`${appsUrl('/create')}?template=${t.id}`}
                className="w-full py-2.5 bg-surface hover:bg-dream/20 border border-dream/30 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                Use Template
              </Link>
              <Link href={marketplaceUrl(`/${t.id}`)} className="mt-2 w-full py-2 text-sm text-text-muted hover:text-text-primary transition-colors flex items-center justify-center">
                View details
              </Link>
              {t.isOwner && (
                <button onClick={() => deleteTemplate(t)} disabled={deletingTemplateId === t.id} className="mt-2 w-full py-2 text-sm text-red-300 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                  {deletingTemplateId === t.id ? <div className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {deletingTemplateId === t.id ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        );
        })}
      </div>}
      </section>
    </div>
  );
}
