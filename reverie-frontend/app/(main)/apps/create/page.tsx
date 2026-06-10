'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Globe, Plus, Trash2, Users, Bot, X } from 'lucide-react';
import { cacheServerAgents, cacheServerWorld, flushClientCacheToServer, getCachedValue, mergePendingLocalById, setCachedValue } from '@/lib/client/query-cache';
import { demoTemplates } from '@/lib/shared/demo-data';
import { useAgents } from '@/lib/hooks/useAgents';
import { getAssignedWorld } from '@/lib/shared/agent-identity';
import { getTemplateBuilderConfig } from '@/lib/shared/world-builder/defaults';
import { appsUrl, worldUrl } from '@/lib/shared/routes';
import type { AgentSummary, TemplateSummary } from '@/lib/shared/types';

const BLANK_TEMPLATE = {
  id: 'blank',
  slug: 'blank',
  name: 'Blank World',
  author: 'You',
  downloads: '0',
  tags: ['Blank'],
  description: 'No preconfigured agents, zones, or factions.',
  features: ['Custom agents', 'Custom zones', 'Custom factions'],
  category: 'custom' as const,
  featured: false,
};

interface DraftZone {
  id: string;
  name: string;
  allocationPercent: number;
}

interface DraftFaction {
  id: string;
  name: string;
  allocationPercent: number;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clampPercent(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Math.max(0, Math.min(100, Number.isFinite(parsed) ? Math.round(parsed) : 0));
}

function distributePercent(count: number) {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_item, index) => base + (index < remainder ? 1 : 0));
}

function rebalanceGroup<T extends { allocationPercent: number }>(items: T[]) {
  const allocations = distributePercent(items.length);
  return items.map((item, index) => ({ ...item, allocationPercent: allocations[index] ?? 0 }));
}

function normalizeAllocationGroup<T extends { allocationPercent: number }>(items: T[], changedIndex: number, nextValue: number): T[] {
  if (items.length <= 1) return items.map((item) => ({ ...item, allocationPercent: 100 }));
  const clamped = clampPercent(nextValue);
  const remaining = 100 - clamped;
  const otherIndexes = items.map((_item, index) => index).filter((index) => index !== changedIndex);
  const otherTotal = otherIndexes.reduce((total, index) => total + clampPercent(items[index].allocationPercent), 0);
  let used = 0;
  return items.map((item, index) => {
    if (index === changedIndex) return { ...item, allocationPercent: clamped };
    const isLastOther = index === otherIndexes[otherIndexes.length - 1];
    const nextAllocation = otherTotal > 0
      ? Math.round((clampPercent(item.allocationPercent) / otherTotal) * remaining)
      : Math.floor(remaining / otherIndexes.length);
    const allocationPercent = isLastOther ? Math.max(0, remaining - used) : nextAllocation;
    used += allocationPercent;
    return { ...item, allocationPercent };
  });
}

export default function CreateWorldPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const templateParam = searchParams.get('template');
  const templateLocked = Boolean(templateParam);
  const [availableTemplates, setAvailableTemplates] = useState<TemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const templates = useMemo(() => [BLANK_TEMPLATE, ...availableTemplates], [availableTemplates]);
  const initialTemplate = templates.find((item) => item.id === templateParam || item.slug === templateParam)?.id ?? (templateLocked ? templateParam! : 'blank');
  const { data: agents = [] } = useAgents();
  const attachableAgents = useMemo(() => agents.filter((agent) => agent.status === 'ACTIVE' && !getAssignedWorld(agent).id), [agents]);

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState(initialTemplate);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [zones, setZones] = useState<DraftZone[]>([]);
  const [factions, setFactions] = useState<DraftFaction[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [agentToAdd, setAgentToAdd] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadTemplates() {
      const cached = getCachedValue<TemplateSummary[]>('templates');
      const response = await fetch('/api/templates?scope=create').then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? 'Unable to load templates.');
        return data;
      }).catch((error) => ({ error: error instanceof Error ? error.message : 'Unable to load templates.' }));
      if (cancelled) return;
      if (response.error) {
        setTemplateLoadError(response.error);
        setAvailableTemplates([]);
        setTemplatesLoading(false);
        return;
      }
      const upstream = Array.isArray(response.templates)
          ? response.templates
          : response.source === 'demo'
            ? demoTemplates
            : [];
      const merged = mergePendingLocalById('templates', cached, upstream);
      setCachedValue('templates', merged);
      for (const item of merged) setCachedValue(`template:${item.id}`, item);
      setAvailableTemplates(merged);
      setTemplateLoadError(null);
      setTemplatesLoading(false);
    }
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTemplate = templates.find((item) => item.id === template || item.slug === template) ?? BLANK_TEMPLATE;

  const addZone = () => {
    const nextNumber = zones.length + 1;
    setZones((current) => rebalanceGroup([...current, {
      id: `zone-${nextNumber}`,
      name: `Route Zone ${nextNumber}`,
      allocationPercent: 0,
    }]));
  };

  const addFaction = () => {
    const nextNumber = factions.length + 1;
    setFactions((current) => rebalanceGroup([...current, {
      id: `faction-${nextNumber}`,
      name: `Faction ${nextNumber}`,
      allocationPercent: 0,
    }]));
  };

  const zoneTotal = zones.reduce((total, zone) => total + (Number.isFinite(zone.allocationPercent) ? zone.allocationPercent : 0), 0);
  const factionTotal = factions.reduce((total, faction) => total + (Number.isFinite(faction.allocationPercent) ? faction.allocationPercent : 0), 0);
  const allocationInvalid = zoneTotal > 100 || factionTotal > 100;

  const handleDeploy = async () => {
    if (allocationInvalid) {
      setDeployError('Zone and faction allocation totals must each stay at or below 100% before deploy.');
      return;
    }
    const assignedAgent = selectedAgentIds
      .map((agentId) => agents.find((agent) => agent.id === agentId))
      .find((agent) => agent && getAssignedWorld(agent).id);
    if (assignedAgent) {
      const assignedWorld = getAssignedWorld(assignedAgent);
      setDeployError(`Unassign this agent from ${assignedWorld.name || assignedWorld.id} before attaching it to another world.`);
      return;
    }
    setIsDeploying(true);
    setDeployError(null);
    try {
      await flushClientCacheToServer();
      const contractAddress = '0x0000000000000000000000000000000000000000';
      const worldSlug = slugify(name);
      let targetWorldHref = appsUrl();
      const builderConfig = getTemplateBuilderConfig(selectedTemplate.slug === 'blank' ? 'blank' : selectedTemplate.slug, name);
      builderConfig.agentChain = [
        ...(builderConfig.agentChain ?? []),
        ...selectedAgentIds
          .map((agentId) => agents.find((agent) => agent.id === agentId))
          .filter(Boolean)
          .map((agent) => ({
            id: agent!.id,
            agentId: agent!.id,
            name: agent!.name,
            agentType: agent!.type,
            purpose: agent!.description || 'Attached world agent.',
            inputTemplate: 'Use the current world state and trigger payload.',
            persistResult: Boolean(agent!.config?.persistOnChain),
          })),
      ];
      const worldState = {
        template,
        agents: selectedAgentIds,
        zones,
        factions,
        entities: [],
        builder: builderConfig,
      };

      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          contractAddress,
          templateId: template === 'blank' ? 'void' : template,
          worldState,
        }),
      }).catch(() => null);

      const data = await res?.json().catch(() => ({}));
      if (!res?.ok) {
        throw new Error(data?.error ?? 'Failed to create world.');
      }

      if (data.world) {
        targetWorldHref = worldUrl({ id: data.world.id ?? worldSlug, name: data.world.name ?? name });
        cacheServerWorld(data.world);
        if (data.world.worldState) setCachedValue(`world:${data.world.id}:state`, data.world.worldState);
        queryClient.setQueryData(['worlds'], (current: unknown) => (
          Array.isArray(current)
            ? [data.world, ...current.filter((item) => item?.id !== data.world.id)]
            : [data.world]
        ));
        if (Array.isArray(data.createdAgents) && data.createdAgents.length > 0) {
          const createdAgents = data.createdAgents as AgentSummary[];
          cacheServerAgents(createdAgents);
          queryClient.setQueryData<AgentSummary[]>(['agents'], (current = agents) => {
            const incomingIds = new Set(createdAgents.map((agent) => agent.id));
            return [...createdAgents, ...current.filter((agent) => !incomingIds.has(agent.id))];
          });
        }
      }

      window.location.href = targetWorldHref;
    } catch (err: unknown) {
      console.error('Deploy failed:', err);
      setDeployError(
        err instanceof Error
          ? err.message
          : 'World creation failed. Check your configuration and try again.'
      );
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <Link href={appsUrl()} className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to worlds
        </Link>
        <h1 className="text-3xl font-display font-bold mb-2">Create New World</h1>
        <p className="text-text-muted">Start blank or from a template, then choose agents, zones, and factions. Live deployment happens from world settings.</p>
      </div>

      <div className="glass-panel p-8">
        <div className="flex items-center justify-between mb-12 relative">
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-dream/20 -z-10" />
          {[1, 2, 3].map((num) => (
            <div key={num} className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
              step >= num ? 'bg-dream text-void shadow-[0_0_15px_rgba(155,127,232,0.5)]' : 'bg-surface text-text-muted border border-dream/20'
            }`}>
              {num}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <label className="block">
              <span className="block text-sm font-medium mb-2">World Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Atlantic Cargo Guard"
                className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-teal transition-colors"
              />
            </label>

            {templateLocked ? (
              <div className="p-4 rounded-lg border border-teal/20 bg-teal/5 flex items-start gap-3">
                <Globe className="w-5 h-5 text-teal mt-0.5" />
                <div>
                  <p className="font-medium">
                    {templatesLoading ? 'Loading selected template...' : selectedTemplate.name}
                  </p>
                  <p className="text-sm text-text-muted">
                    {templateLoadError ?? 'Template selected from the marketplace. The wizard will not ask you to choose it again.'}
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-4">Choose a template or start blank</label>
                {templatesLoading && (
                  <div className="mb-4 rounded-lg border border-dream/20 bg-surface p-4 text-sm text-text-muted flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-dream/30 border-t-dream rounded-full animate-spin" />
                    Loading templates...
                  </div>
                )}
                {!templatesLoading && templateLoadError && (
                  <div className="mb-4 rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">
                    {templateLoadError}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {templates.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTemplate(item.id)}
                      className={`text-left p-4 rounded-lg border transition-all ${
                        template === item.id
                          ? 'border-teal bg-teal/10'
                          : 'border-dream/20 bg-surface hover:border-dream/50'
                      }`}
                    >
                      <Globe className={`w-6 h-6 mb-3 ${template === item.id ? 'text-teal' : 'text-dream'}`} />
                      <h3 className="font-medium mb-1">{item.name}</h3>
                      <p className="text-xs text-text-muted">{item.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setStep(2)}
              disabled={!name || (templateLocked && templatesLoading)}
              className="w-full py-3 bg-dream hover:bg-aurora text-void font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-8 flex items-center justify-center gap-2"
            >
              Configure World
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-display font-semibold flex items-center gap-2"><Bot className="w-5 h-5 text-dream" /> Agents</h2>
                  <p className="text-sm text-text-muted">Attach available user and official agents. Use the selector so large libraries stay manageable.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <select value={agentToAdd} onChange={(event) => setAgentToAdd(event.target.value)} className="bg-void border border-dream/30 rounded-lg px-4 py-3">
                  <option value="">Select an agent to attach</option>
                  {attachableAgents.filter((agent) => !selectedAgentIds.includes(agent.id)).map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name} - {agent.type}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (!agentToAdd) return;
                    setSelectedAgentIds((current) => [...current, agentToAdd]);
                    setAgentToAdd('');
                  }}
                  className="px-4 py-3 border border-dream/30 rounded-lg flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Attach
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {selectedAgentIds.length === 0 && <span className="text-sm text-text-muted">No agents attached yet.</span>}
                {selectedAgentIds.map((agentId) => {
                  const agent = agents.find((item) => item.id === agentId);
                  return (
                    <span key={agentId} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-dream/10 border border-dream/20 text-dream text-sm">
                      {agent?.name ?? agentId}
                      <button onClick={() => setSelectedAgentIds((current) => current.filter((id) => id !== agentId))}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-display font-semibold flex items-center gap-2"><Globe className="w-5 h-5 text-teal" /> Zones</h2>
                    <p className="text-sm text-text-muted">Create initial zones. Allocation always totals 100% across the group.</p>
                </div>
                <button onClick={addZone} className="px-3 py-2 border border-dream/30 rounded-lg flex items-center gap-2 text-sm"><Plus className="w-4 h-4" /> Add Zone</button>
              </div>
              <p className={`mb-3 text-sm ${zoneTotal > 100 ? 'text-red-300' : 'text-text-muted'}`}>
                Zone allocation: {zoneTotal}% assigned across all zones.
              </p>
              <div className="space-y-3">
                {zones.length === 0 && <p className="text-sm text-text-muted bg-void/50 border border-dream/10 rounded-lg p-4">No initial zones. The world can still create zones later.</p>}
                {zones.length > 0 && (
                  <div className="hidden md:grid grid-cols-[1fr_160px_auto] gap-3 px-3 text-xs font-medium uppercase tracking-wide text-text-muted">
                    <span>Name</span>
                    <span>Allocation %</span>
                    <span className="sr-only">Action</span>
                  </div>
                )}
                {zones.map((zone, index) => (
                  <div key={zone.id} className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-3 bg-void/50 border border-dream/10 rounded-lg p-3">
                    <label className="block">
                      <span className="md:hidden mb-1 block text-xs font-medium text-text-muted">Name</span>
                      <input aria-label="Zone name" placeholder="Name" value={zone.name} onChange={(event) => setZones((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} className="w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    <label className="block">
                      <span className="md:hidden mb-1 block text-xs font-medium text-text-muted">Allocation %</span>
                      <input aria-label="Zone allocation percent" placeholder="0" type="number" min={0} max={100} value={zone.allocationPercent} onChange={(event) => setZones((current) => normalizeAllocationGroup(current, index, Number(event.target.value)))} className="w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    <button onClick={() => setZones((current) => rebalanceGroup(current.filter((_, i) => i !== index)))} className="px-3 py-2 border border-red-500/20 text-red-300 rounded"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-display font-semibold flex items-center gap-2"><Users className="w-5 h-5 text-aurora" /> Factions</h2>
                  <p className="text-sm text-text-muted">Create factions. Allocation always totals 100% across the group.</p>
                </div>
                <button onClick={addFaction} className="px-3 py-2 border border-dream/30 rounded-lg flex items-center gap-2 text-sm"><Plus className="w-4 h-4" /> Add Faction</button>
              </div>
              <p className={`mb-3 text-sm ${factionTotal > 100 ? 'text-red-300' : 'text-text-muted'}`}>
                Faction allocation: {factionTotal}% assigned across all factions.
              </p>
              <div className="space-y-3">
                {factions.length === 0 && <p className="text-sm text-text-muted bg-void/50 border border-dream/10 rounded-lg p-4">No initial factions. The world can still create factions later.</p>}
                {factions.length > 0 && (
                  <div className="hidden md:grid grid-cols-[1fr_160px_auto] gap-3 px-3 text-xs font-medium uppercase tracking-wide text-text-muted">
                    <span>Name</span>
                    <span>Allocation %</span>
                    <span className="sr-only">Action</span>
                  </div>
                )}
                {factions.map((faction, index) => (
                  <div key={faction.id} className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-3 bg-void/50 border border-dream/10 rounded-lg p-3">
                    <label className="block">
                      <span className="md:hidden mb-1 block text-xs font-medium text-text-muted">Name</span>
                      <input aria-label="Faction name" placeholder="Name" value={faction.name} onChange={(event) => setFactions((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} className="w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    <label className="block">
                      <span className="md:hidden mb-1 block text-xs font-medium text-text-muted">Allocation %</span>
                      <input aria-label="Faction allocation percent" placeholder="0" type="number" min={0} max={100} value={faction.allocationPercent} onChange={(event) => setFactions((current) => normalizeAllocationGroup(current, index, Number(event.target.value)))} className="w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    <button onClick={() => setFactions((current) => rebalanceGroup(current.filter((_, i) => i !== index)))} className="px-3 py-2 border border-red-500/20 text-red-300 rounded"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex gap-4 mt-8">
              <button onClick={() => setStep(1)} className="px-6 py-3 border border-dream/30 hover:bg-dream/10 rounded-lg transition-colors font-medium">Back</button>
              <button onClick={() => setStep(3)} disabled={allocationInvalid} className="flex-1 py-3 bg-dream hover:bg-aurora text-void font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                Review & Create
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-void border border-dream/20 rounded-lg p-6">
              <h3 className="font-display text-xl mb-4 border-b border-dream/10 pb-4">World Summary</h3>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between"><span className="text-text-muted">World Name</span><span className="font-medium">{name}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Template</span><span className="font-medium">{selectedTemplate.name}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Agents</span><span className="font-medium">{selectedAgentIds.length}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Zones</span><span className="font-medium">{zones.length}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Zone Allocation</span><span className={zoneTotal > 100 ? 'font-medium text-red-300' : 'font-medium'}>{zoneTotal}%</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Factions</span><span className="font-medium">{factions.length}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Faction Allocation</span><span className={factionTotal > 100 ? 'font-medium text-red-300' : 'font-medium'}>{factionTotal}%</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Network</span><span className="font-medium text-teal">Somnia Testnet</span></div>
              </div>
              <div className="mt-5 rounded-lg border border-teal/20 bg-teal/10 p-4 text-sm text-teal">
                On create, REVERIE copies the selected template into your own world. Template triggers, zones, factions, agents, inputs, and data sources are preserved; anything you added in this wizard is appended to that private copy and does not change the marketplace template.
              </div>
            </div>

            {allocationInvalid && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3 text-sm text-red-300"><AlertTriangle className="w-5 h-5 shrink-0" /><span>Zone and faction allocation totals must each stay at or below 100% before deploy.</span></div>}

            {deployError && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3 text-sm text-red-300"><AlertTriangle className="w-5 h-5 shrink-0" /><span>{deployError}</span></div>}

            <div className="flex gap-4 mt-8">
              <button onClick={() => setStep(2)} disabled={isDeploying} className="px-6 py-3 border border-dream/30 hover:bg-dream/10 rounded-lg transition-colors font-medium disabled:opacity-50">Back</button>
              <button onClick={handleDeploy} disabled={isDeploying || allocationInvalid} className="flex-1 py-3 bg-teal hover:bg-teal/80 text-void font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-70">
                {isDeploying ? <><div className="w-5 h-5 border-2 border-void/30 border-t-void rounded-full animate-spin" /> Creating World...</> : <><CheckCircle2 className="w-5 h-5" /> Confirm & Create</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
