'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Braces, ExternalLink, Eye, GitBranch, KeyRound, Plus, Save, Trash2, UploadCloud, Zap } from 'lucide-react';
import { cacheServerAgents, cacheServerWorld, removeCachedAgents, removeCachedWorld } from '@/lib/client/query-cache';
import { compileLiveManifest } from '@/lib/client/live-world';
import { applyArmAndMaybeStartWorld } from '@/lib/client/live-lifecycle';
import { resolveBuilderForLiveManifest } from '@/lib/client/live-manifest-resolution';
import { applyLiveBuilderAgentDefaults } from '@/lib/shared/live-agent-step-defaults';
import { useAgents } from '@/lib/hooks/useAgents';
import { useTools } from '@/lib/hooks/useTools';
import { appsUrl, worldUrl } from '@/lib/shared/routes';
import { estimateRuntimeCost } from '@/lib/shared/world-runtime/lifecycle';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import type { AgentSummary, AgentType, RuntimeCostEstimate, WorldBuilderConfig, WorldBuilderAgentStep, WorldSummary } from '@/lib/shared/types';

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)];
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function distributePercent(count: number) {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_item, index) => base + (index < remainder ? 1 : 0));
}

function clampPercent(value: unknown) {
  const parsed = numberValue(value, 0);
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function parseStt(value: string | undefined) {
  const parsed = Number.parseFloat(String(value ?? '0').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAllocationGroup<T extends { allocationPercent?: number }>(items: T[], changedIndex: number, nextValue: number): T[] {
  if (items.length === 0) return items;
  if (items.length === 1) return [{ ...items[0], allocationPercent: 100 }];
  const clamped = clampPercent(nextValue);
  const remaining = 100 - clamped;
  const others = items.filter((_item, index) => index !== changedIndex);
  const otherTotal = others.reduce((total, item) => total + clampPercent(item.allocationPercent), 0);
  let used = 0;
  return items.map((item, index) => {
    if (index === changedIndex) return { ...item, allocationPercent: clamped };
    const isLastOther = index === items.length - 1 || items.slice(index + 1).every((_next, nextOffset) => index + 1 + nextOffset === changedIndex);
    const nextAllocation = otherTotal > 0
      ? Math.round((clampPercent(item.allocationPercent) / otherTotal) * remaining)
      : Math.floor(remaining / others.length);
    const allocationPercent = isLastOther ? Math.max(0, remaining - used) : nextAllocation;
    used += allocationPercent;
    return { ...item, allocationPercent };
  });
}

type ManifestPreview = {
  manifest: {
    manifestHash?: string;
    zones?: Array<{ sourceId?: string; zoneId?: string; name?: string }>;
    factions?: Array<{ sourceId?: string; factionId?: string; name?: string }>;
    triggers?: Array<{ triggerId?: string; schedule?: unknown }>;
    relationships?: Array<unknown>;
    unsupported?: string[];
    summary?: { relationshipCount?: number; triggerCount?: number; stepCount?: number };
  } | null;
  cost: RuntimeCostEstimate | null;
  resolvedInputSnapshot?: { dataSources?: Record<string, unknown> } | null;
  resolvedAgentUrls?: Array<{ id?: string; name?: string; url?: string }>;
  resolvedRouteProgressCoordinate?: { latitude: number; longitude: number } | null;
  error?: string | null;
};

export default function WorldBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const worldId = params.worldId as string;
  const hostWorldSlug = useWorldSlugFromHost();
  const [builder, setBuilder] = useState<WorldBuilderConfig | null>(null);
  const [worldSummary, setWorldSummary] = useState<WorldSummary | null>(null);
  const [jsonDraft, setJsonDraft] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [secretKeys, setSecretKeys] = useState<Array<{ key: string; updatedAt?: string }>>([]);
  const [message, setMessage] = useState('Loading builder config...');
  const [messageTone, setMessageTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [arming, setArming] = useState(false);
  const [secretSaving, setSecretSaving] = useState(false);
  const [deletingWorld, setDeletingWorld] = useState(false);
  const [agentToAdd, setAgentToAdd] = useState('');
  const [toolToAdd, setToolToAdd] = useState('');
  const [manifestPreview, setManifestPreview] = useState<ManifestPreview>({ manifest: null, cost: null });
  const [confirmedSubscriptions, setConfirmedSubscriptions] = useState<Array<Record<string, unknown>>>([]);
  const [rpcBalanceStt, setRpcBalanceStt] = useState<number | null>(null);
  const { data: agents = [] } = useAgents();
  const { data: tools = [] } = useTools();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [builderResponse, secretsResponse] = await Promise.all([
          fetch(`/api/apps/${worldId}/builder`).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error ?? 'Unable to load builder config.');
            return data;
          }),
          fetch(`/api/apps/${worldId}/secrets`).then((res) => res.json()).catch(() => ({ secrets: [] })),
        ]);
        if (cancelled) return;
        if (!builderResponse.builder) throw new Error('Builder config was not returned by the server.');
        if (builderResponse.world?.contractAddress) {
          const live = await fetch(`/api/apps/${worldId}/runtime/live`).then((res) => res.json()).catch(() => null);
          if (live && !live.error) {
            setConfirmedSubscriptions(Array.isArray(live.confirmedSubscriptions) ? live.confirmedSubscriptions : []);
            const balance = Number(live.rpcBalance?.balanceStt);
            setRpcBalanceStt(Number.isFinite(balance) ? balance : null);
            if (live.world) {
              setWorldSummary(live.world);
            }
          }
        }
        setBuilder(builderResponse.builder);
        setWorldSummary((current) => current ?? builderResponse.world ?? null);
        setJsonDraft(pretty(builderResponse.builder));
        setSecretKeys(secretsResponse.secrets ?? []);
        setMessage(`Builder loaded from ${builderResponse.source ?? 'database'}.`);
        setMessageTone('neutral');
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : 'Unable to load builder config.');
        setMessageTone('error');
        if (error instanceof Error && error.message === 'World not found') {
          removeCachedWorld(worldId);
          queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => current.filter((item) => item.id !== worldId));
          setNotFound(true);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [queryClient, worldId]);

  const runtimeUrl = useMemo(() => {
    const runtimeSlug = builder?.uiSlug || worldId;
    return worldUrl({ id: worldId, name: builder?.displayName, slug: hostWorldSlug }, `/${runtimeSlug}`);
  }, [builder?.displayName, builder?.uiSlug, hostWorldSlug, worldId]);

  const triggersUrl = useMemo(() => (
    worldUrl({ id: worldId, name: builder?.displayName, slug: hostWorldSlug }, '/triggers')
  ), [builder?.displayName, hostWorldSlug, worldId]);

  const addedAgentIds = useMemo(() => new Set((builder?.agentChain ?? []).map((step) => step.agentId ?? step.id)), [builder?.agentChain]);
  const addedToolIds = useMemo(() => new Set((builder?.agentChain ?? []).filter((step) => step.stepType === 'tool').map((step) => step.toolId ?? step.id)), [builder?.agentChain]);
  const addableAgents = useMemo(() => (
    agents.filter((agent) => agent.status === 'ACTIVE' && !addedAgentIds.has(agent.id))
  ), [addedAgentIds, agents]);
  const addableTools = useMemo(() => (
    tools.filter((tool) => tool.status === 'deployed' && !addedToolIds.has(tool.id))
  ), [addedToolIds, tools]);
  const zoneAllocationTotal = useMemo(() => (builder?.zones ?? []).reduce((total, zone) => total + numberValue(zone.allocationPercent), 0), [builder?.zones]);
  const factionAllocationTotal = useMemo(() => (builder?.factions ?? []).reduce((total, faction) => total + numberValue(faction.allocationPercent), 0), [builder?.factions]);
  const autonomousTriggerCount = useMemo(() => (builder?.triggers ?? []).filter((trigger) => (
    trigger.isActive !== false && (trigger.type === 'scheduled' || trigger.type === 'contract_event')
  )).length, [builder?.triggers]);
  const runtimeSubscribed = autonomousTriggerCount === 0 || confirmedSubscriptions.length >= autonomousTriggerCount;
  const hasMinimumFunding = Math.max(parseStt(worldSummary?.balance), rpcBalanceStt ?? 0) >= (manifestPreview.cost?.minimumBalanceStt ?? 0);
  const canApplyArm = Boolean(
    builder?.lastPublishedAt &&
    worldSummary?.contractAddress &&
    worldSummary.status !== 'running' &&
    hasMinimumFunding &&
    runtimeSubscribed
  );

  useEffect(() => {
    if (!builder) return;
    const previewBuilder = builder;
    let cancelled = false;
    async function compile() {
      try {
        const resolved = await resolveBuilderForLiveManifest({ builder: previewBuilder, publicState: { builder: previewBuilder } });
        const manifest = await compileLiveManifest(resolved.builder);
        const cost = estimateRuntimeCost(previewBuilder);
        const urlRows = (resolved.builder.agentChain ?? [])
          .map((step) => {
            const record = step as WorldBuilderAgentStep & { url?: string };
            const extra = record as unknown as Record<string, unknown>;
            const sourceStepId = typeof extra.sourceStepId === 'string'
              ? String(extra.sourceStepId)
              : step.id;
            return { id: sourceStepId, name: step.name, url: step.urlTemplate ?? record.url };
          })
          .filter((step) => typeof step.url === 'string' && step.url.trim());
        const resolvedAgentUrls = Array.from(new Map(urlRows.map((step) => [`${step.id}:${step.url}`, step])).values());
        const latitude = readPath(resolved.snapshot, 'dataSources.routeProgress.body.progress.projectedPosition.latitude');
        const longitude = readPath(resolved.snapshot, 'dataSources.routeProgress.body.progress.projectedPosition.longitude');
        const resolvedRouteProgressCoordinate = typeof latitude === 'number' && typeof longitude === 'number'
          ? { latitude, longitude }
          : null;
        const manifestForPreview = manifest as unknown as NonNullable<ManifestPreview['manifest']>;
        const unsupported = [
          ...(manifestForPreview.unsupported ?? []),
        ];
        if (!cancelled) setManifestPreview({
          manifest: { ...manifestForPreview, unsupported: Array.from(new Set(unsupported)) },
          cost,
          resolvedInputSnapshot: resolved.snapshot,
          resolvedAgentUrls,
          resolvedRouteProgressCoordinate,
        });
      } catch (error) {
        if (!cancelled) setManifestPreview({ manifest: null, cost: estimateRuntimeCost(previewBuilder), error: error instanceof Error ? error.message : 'Unable to compile manifest preview.' });
      }
    }
    void compile();
    return () => {
      cancelled = true;
    };
  }, [builder]);

  const updateField = (key: keyof WorldBuilderConfig, value: string) => {
    if (!builder) return;
    const next = { ...builder, [key]: value };
    setBuilder(next);
    setJsonDraft(pretty(next));
  };

  const setBuilderDraft = (next: WorldBuilderConfig) => {
    setBuilder(next);
    setJsonDraft(pretty(next));
  };

  const addInput = () => {
    if (!builder) return;
    const index = builder.inputSchema.length + 1;
    setBuilderDraft({
      ...builder,
      inputSchema: [...builder.inputSchema, { id: `input-${index}`, label: `Input ${index}`, type: 'text', required: false, defaultValue: '' }],
    });
  };

  const updateInput = (index: number, patch: Partial<WorldBuilderConfig['inputSchema'][number]>) => {
    if (!builder) return;
    setBuilderDraft({ ...builder, inputSchema: builder.inputSchema.map((input, i) => i === index ? { ...input, ...patch } : input) });
  };

  const addDataSource = () => {
    if (!builder) return;
    const index = builder.dataSources.length + 1;
    setBuilderDraft({
      ...builder,
      dataSources: [...builder.dataSources, { id: `data-source-${index}`, name: `Data Source ${index}`, type: 'json', method: 'GET', url: '' }],
    });
  };

  const updateDataSource = (index: number, patch: Partial<WorldBuilderConfig['dataSources'][number]>) => {
    if (!builder) return;
    setBuilderDraft({ ...builder, dataSources: builder.dataSources.map((source, i) => i === index ? { ...source, ...patch } : source) });
  };

  const addZone = () => {
    if (!builder) return;
    const zones = builder.zones ?? [];
    const index = zones.length + 1;
    setBuilderDraft({
      ...builder,
      zones: [...zones, {
        id: `zone-${index}`,
        name: `Zone ${index}`,
        description: '',
        allocationPercent: 0,
        state: { latestDecision: 'pending', dangerLevel: 0, controllingFaction: builder.factions?.[0]?.id ?? 'unassigned', climate: 'CALM' },
      }],
    });
  };

  const addFaction = () => {
    if (!builder) return;
    const factions = builder.factions ?? [];
    const index = factions.length + 1;
    setBuilderDraft({
      ...builder,
      factions: [...factions, {
        id: `faction-${index}`,
        name: `Faction ${index}`,
        description: '',
        allocationPercent: 0,
        state: { latestDecision: 'pending', morale: 50, narrative: `Faction ${index} is initialized from the builder manifest.` },
      }],
    });
  };

  const updateZone = (index: number, patch: Partial<NonNullable<WorldBuilderConfig['zones']>[number]>) => {
    if (!builder) return;
    const zones = builder.zones ?? [];
    if (patch.allocationPercent !== undefined) {
      setBuilderDraft({ ...builder, zones: normalizeAllocationGroup(zones, index, patch.allocationPercent).map((item, i) => i === index ? { ...item, ...patch, allocationPercent: item.allocationPercent } : item) });
      return;
    }
    setBuilderDraft({ ...builder, zones: zones.map((item, i) => i === index ? { ...item, ...patch } : item) });
  };

  const updateZoneState = (index: number, patch: Record<string, unknown>) => {
    if (!builder) return;
    setBuilderDraft({
      ...builder,
      zones: (builder.zones ?? []).map((item, i) => i === index ? { ...item, state: { ...objectValue(item.state), ...patch } } : item),
    });
  };

  const updateFaction = (index: number, patch: Partial<NonNullable<WorldBuilderConfig['factions']>[number]>) => {
    if (!builder) return;
    const factions = builder.factions ?? [];
    if (patch.allocationPercent !== undefined) {
      setBuilderDraft({ ...builder, factions: normalizeAllocationGroup(factions, index, patch.allocationPercent).map((item, i) => i === index ? { ...item, ...patch, allocationPercent: item.allocationPercent } : item) });
      return;
    }
    setBuilderDraft({ ...builder, factions: factions.map((item, i) => i === index ? { ...item, ...patch } : item) });
  };

  const updateFactionState = (index: number, patch: Record<string, unknown>) => {
    if (!builder) return;
    setBuilderDraft({
      ...builder,
      factions: (builder.factions ?? []).map((item, i) => i === index ? { ...item, state: { ...objectValue(item.state), ...patch } } : item),
    });
  };

  const rebalanceZones = () => {
    if (!builder) return;
    const allocations = distributePercent((builder.zones ?? []).length);
    setBuilderDraft({ ...builder, zones: (builder.zones ?? []).map((zone, index) => ({ ...zone, allocationPercent: allocations[index] ?? 0 })) });
  };

  const rebalanceFactions = () => {
    if (!builder) return;
    const allocations = distributePercent((builder.factions ?? []).length);
    setBuilderDraft({ ...builder, factions: (builder.factions ?? []).map((faction, index) => ({ ...faction, allocationPercent: allocations[index] ?? 0 })) });
  };

  const addAgentStep = () => {
    if (!builder || !agentToAdd) return;
    if (builder.agentChain.some((step) => (step.agentId ?? step.id) === agentToAdd)) {
      setAgentToAdd('');
      return;
    }
    const agent = agents.find((item) => item.id === agentToAdd);
    if (!agent) return;
    setBuilderDraft({
      ...builder,
      agentChain: [...builder.agentChain, {
        id: agent.id,
        agentId: agent.id,
        name: agent.name,
        agentType: agent.type,
        purpose: agent.description || 'Attached world agent.',
        inputTemplate: 'Use the trigger payload and current world state.',
        persistResult: Boolean(agent.config?.persistOnChain),
      }],
    });
    setAgentToAdd('');
  };

  const updateChainStep = (index: number, patch: Partial<WorldBuilderAgentStep>) => {
    if (!builder) return;
    setBuilderDraft({ ...builder, agentChain: builder.agentChain.map((item, i) => i === index ? { ...item, ...patch } : item) });
  };

  const addToolStep = () => {
    if (!builder || !toolToAdd) return;
    const tool = tools.find((item) => item.id === toolToAdd);
    if (!tool) return;
    setBuilderDraft({
      ...builder,
      agentChain: [...builder.agentChain, {
        id: `tool-${tool.id}`,
        stepType: 'tool',
        agentType: 'reverie_custom',
        toolId: tool.id,
        toolSlug: tool.slug,
        toolEndpointUrl: tool.endpointUrl,
        name: tool.name,
        purpose: tool.description || 'Deployed user tool.',
        inputTemplate: 'Call this tool and pass its JSON output to the next agent.',
        toolInputTemplate: pretty(tool.inputSample ?? { input: '{{previous.output}}' }),
        consumePreviousOutput: true,
        outputSchema: tool.mcpMetadata?.outputSchema,
        persistResult: true,
      }],
    });
    setToolToAdd('');
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as WorldBuilderConfig;
      setBuilder(parsed);
      setMessage('JSON draft applied locally. Save to persist it.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid JSON draft.');
    }
  };

  const save = async () => {
    if (!builder) return;
    setSaving(true);
    setMessage('Saving builder...');
    setMessageTone('neutral');
    try {
      const response = await fetch(`/api/apps/${worldId}/builder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ builder }),
      }).then((res) => res.json());
      if (response.error) throw new Error(response.error);
      setBuilder(response.builder ?? builder);
      setJsonDraft(pretty(response.builder ?? builder));
      if (response.world) {
        cacheServerWorld(response.world);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
          [response.world as WorldSummary, ...current.filter((item) => item.id !== response.world.id)]
        ));
      }
      const changedAgents = [
        ...(Array.isArray(response.createdAgents) ? response.createdAgents as AgentSummary[] : []),
        ...(Array.isArray(response.updatedAgents) ? response.updatedAgents as AgentSummary[] : []),
      ];
      if (changedAgents.length > 0) {
        cacheServerAgents(changedAgents);
        queryClient.setQueryData<AgentSummary[]>(['agents'], (current = agents) => {
          const incomingIds = new Set(changedAgents.map((agent) => agent.id));
          return [...changedAgents, ...current.filter((agent) => !incomingIds.has(agent.id))];
        });
      }
      setMessage(`Builder saved. Agent assignments and world state were synchronized.`);
      setMessageTone('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save builder.');
      setMessageTone('error');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    await save();
    try {
      const response = await fetch(`/api/apps/${worldId}/builder/publish`, { method: 'POST' }).then((res) => res.json());
      if (response.error) throw new Error(response.error);
      if (response.world) {
        cacheServerWorld(response.world);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
          [response.world as WorldSummary, ...current.filter((item) => item.id !== response.world.id)]
        ));
      }
      setMessage(`Runtime published successfully.`);
      setMessageTone('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to publish runtime.');
      setMessageTone('error');
    } finally {
      setPublishing(false);
    }
  };

  const refreshLiveAgentDefaults = () => {
    if (!builder) return;
    const next = applyLiveBuilderAgentDefaults(builder, builder.uiSlug);
    setBuilderDraft(next);
    setMessage('Live agent defaults were refreshed in this draft. Review, then Save and Publish to keep them.');
    setMessageTone('neutral');
  };

  const applyArmRuntime = async () => {
    if (!builder || !worldSummary?.contractAddress) {
      setMessage('Deploy and fund this world before applying and arming runtime.');
      setMessageTone('error');
      return;
    }
    setArming(true);
    setMessage('Saving and publishing the latest builder config...');
    setMessageTone('neutral');
    try {
      const saved = await fetch(`/api/apps/${worldId}/builder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ builder }),
      }).then((res) => res.json());
      if (saved.error) throw new Error(saved.error);
      const published = await fetch(`/api/apps/${worldId}/builder/publish`, { method: 'POST' }).then((res) => res.json());
      if (published.error) throw new Error(published.error);
      const latestBuilder = (published.builder ?? saved.builder ?? builder) as WorldBuilderConfig;
      setBuilder(latestBuilder);
      setJsonDraft(pretty(latestBuilder));
      const preview = await fetch(`/api/apps/${worldId}/deploy/manifest`).then((res) => res.json()).catch(() => ({ error: 'Unable to prepare live manifest.' }));
      if (preview.error) throw new Error(preview.error);
      if (!preview.liveDeployable) throw new Error(`This world cannot be armed live yet: ${(preview.unsupported ?? []).join(' ')}`);
      const result = await applyArmAndMaybeStartWorld({
        worldId,
        world: worldSummary,
        builder: preview.builder,
        publicState: { builder: preview.builder },
        onMessage: (nextMessage) => {
          setMessage(nextMessage);
          setMessageTone('neutral');
        },
      });
      const response = result.startResponse ?? result.armResponse;
      if (response.world) {
        const nextWorld = response.world as WorldSummary;
        setWorldSummary(nextWorld);
        cacheServerWorld(nextWorld);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
          [nextWorld, ...current.filter((item) => item.id !== nextWorld.id)]
        ));
      }
      setMessage(result.startResponse
        ? 'Runtime applied, armed, and the non-manual starting trigger was fired.'
        : 'Runtime applied and armed. Manual starting triggers run only from the runtime button.');
      setMessageTone('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to apply and arm runtime.');
      setMessageTone('error');
    } finally {
      setArming(false);
    }
  };

  const saveSecret = async () => {
    setSecretSaving(true);
    try {
      const response = await fetch(`/api/apps/${worldId}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: secretKey, value: secretValue }),
      }).then((res) => res.json());
      if (response.error) {
        setMessage(response.error);
        setMessageTone('error');
        return;
      }
      setSecretKeys((current) => [{ key: response.secret.key }, ...current.filter((item) => item.key !== response.secret.key)]);
      setSecretKey('');
      setSecretValue('');
      setMessage('Secret key saved. Values are never returned to the browser.');
      setMessageTone('success');
    } finally {
      setSecretSaving(false);
    }
  };

  const deleteWorld = async () => {
    if (worldSummary?.contractAddress) {
      setMessage('Deployed worlds must be stopped and withdrawn from Settings before deletion.');
      setMessageTone('neutral');
      router.push(worldUrl({ id: worldId, name: worldSummary.name ?? builder?.displayName, slug: hostWorldSlug }, '/settings'));
      return;
    }
    if (!window.confirm('Delete this world, assigned user/template agents, runtime state, triggers, events, and secrets? Public templates created from it will remain.')) return;
    setDeletingWorld(true);
    const response = await fetch(`/api/apps/${worldId}/delete/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then((res) => res.json()).catch(() => ({ error: 'Unable to delete world.' }));
    if (response.error) {
      setMessage(response.error);
      setMessageTone('error');
      setDeletingWorld(false);
      return;
    }
    const deletedAgentIds = Array.isArray(response.deletedAgentIds) ? response.deletedAgentIds.filter((id: unknown): id is string => typeof id === 'string') : [];
    removeCachedAgents(deletedAgentIds);
    removeCachedWorld(worldId);
    queryClient.setQueryData<AgentSummary[]>(['agents'], (current = []) => current.filter((agent) => !deletedAgentIds.includes(agent.id)));
    queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => current.filter((item) => item.id !== worldId));
    router.push(appsUrl());
  };

  if (notFound) {
    return (
      <div className="max-w-4xl mx-auto w-full glass-panel p-6">
        <Link href={appsUrl()} className="mb-4 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
          <ArrowLeft className="w-4 h-4" /> Back to worlds
        </Link>
        <h1 className="text-2xl font-display font-bold mb-2">World not found</h1>
        <p className="text-text-muted">{message}</p>
      </div>
    );
  }

  if (!builder) {
    return <div className="glass-panel p-6 text-sm text-text-muted">{message}</div>;
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <Link href={worldUrl({ id: worldId, name: builder.displayName, slug: hostWorldSlug })} className="mb-4 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
            <ArrowLeft className="w-4 h-4" /> Back to world
          </Link>
          <h1 className="text-3xl font-display font-bold mb-1">World UI Builder</h1>
          <p className="text-text-muted">Create reusable runtime interfaces, data sources, agents, and JSON config for this world.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={runtimeUrl} className="px-4 py-2 border border-dream/30 rounded-lg flex items-center gap-2 text-sm">
            <Eye className="w-4 h-4" /> Test Runtime
          </Link>
          <Link href={triggersUrl} className="px-4 py-2 border border-dream/30 hover:bg-dream/10 rounded-lg flex items-center gap-2 text-sm transition-colors">
            <GitBranch className="w-4 h-4" /> Manage Triggers
          </Link>
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-surface border border-dream/30 hover:bg-dream/10 rounded-lg flex items-center gap-2 text-sm transition-colors disabled:opacity-60">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={publish} disabled={publishing || saving} className="px-4 py-2 bg-teal hover:bg-teal/80 text-void rounded-lg flex items-center gap-2 text-sm font-semibold transition-colors disabled:opacity-60">
            <UploadCloud className="w-4 h-4" /> {publishing ? 'Publishing...' : 'Publish'}
          </button>
          <button
            onClick={refreshLiveAgentDefaults}
            disabled={saving || publishing || arming}
            className="px-4 py-2 border border-dream/30 hover:bg-dream/10 rounded-lg flex items-center gap-2 text-sm transition-colors disabled:opacity-60"
            title="Optional: update this draft's agent prompts, JSON URLs, selectors, and context fields to the latest live-compatible defaults."
          >
            <Zap className="w-4 h-4" /> Refresh Agent Defaults
          </button>
          {worldSummary?.contractAddress && (
            <button
              onClick={applyArmRuntime}
              disabled={arming || saving || publishing || !canApplyArm}
              className="px-4 py-2 bg-aurora hover:bg-aurora/80 text-void rounded-lg flex items-center gap-2 text-sm font-semibold transition-colors disabled:opacity-60"
              title={!canApplyArm
                ? autonomousTriggerCount > 0 && !runtimeSubscribed
                  ? 'Subscribe the active scheduled or contract-event triggers before applying and arming.'
                  : 'Publish the builder, deploy the world, and fund above minimum runtime cost before arming.'
                : undefined}
            >
              {arming ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {arming ? 'Applying & arming...' : 'Apply & Arm Runtime'}
            </button>
          )}
          <button onClick={deleteWorld} disabled={deletingWorld} className="px-4 py-2 border border-red-500/30 hover:bg-red-500/10 text-red-300 rounded-lg flex items-center gap-2 text-sm transition-colors disabled:opacity-60">
            {deletingWorld ? <div className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {deletingWorld ? 'Deleting...' : 'Delete World'}
          </button>
        </div>
      </div>
      <div className={`rounded-lg border px-4 py-3 text-sm ${
        messageTone === 'success'
          ? 'border-teal/25 bg-teal/10 text-teal'
          : messageTone === 'error'
            ? 'border-red-500/25 bg-red-500/10 text-red-300'
            : 'border-dream/15 bg-surface/70 text-text-muted'
      }`}>
        {message}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="min-w-0 space-y-6">
          <div className="glass-panel p-6 space-y-4">
            <h2 className="text-lg font-display font-semibold">Runtime Identity</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm text-text-muted">Display name</span>
                <input placeholder="Name" value={builder.displayName} onChange={(event) => updateField('displayName', event.target.value)} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 placeholder:text-text-muted/50" />
              </label>
              <label className="block">
                <span className="text-sm text-text-muted">Runtime slug</span>
                <input placeholder="id" value={builder.uiSlug} onChange={(event) => updateField('uiSlug', event.target.value)} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono placeholder:text-text-muted/50" />
              </label>
            </div>
            <label className="block">
              <span className="text-sm text-text-muted">Description</span>
              <textarea placeholder="Description" value={builder.description} onChange={(event) => updateField('description', event.target.value)} rows={3} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 placeholder:text-text-muted/50" />
            </label>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-panel p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="text-lg font-display font-semibold">Inputs</h2>
                <button onClick={addInput} className="px-3 py-2 border border-dream/30 rounded-lg text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Add</button>
              </div>
              <div className="space-y-3">
                {builder.inputSchema.map((input, index) => (
                  <div key={input.id} className="bg-void/50 border border-dream/10 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs text-text-muted">Input ID</span>
                        <input placeholder="startPortId" value={input.id} onChange={(event) => updateInput(index, { id: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Input label</span>
                        <input placeholder="Start port" value={input.label} onChange={(event) => updateInput(index, { label: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Input type</span>
                        <select value={input.type} onChange={(event) => updateInput(index, { type: event.target.value as WorldBuilderConfig['inputSchema'][number]['type'] })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2">
                          <option value="text">text</option>
                          <option value="number">number</option>
                          <option value="select">select</option>
                          <option value="json">json</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Default value</span>
                        <input value={String(input.defaultValue ?? '')} onChange={(event) => updateInput(index, { defaultValue: event.target.value })} placeholder="Value used when browser input is empty" className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2" />
                      </label>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm text-text-muted">
                        <input type="checkbox" checked={input.required} onChange={(event) => updateInput(index, { required: event.target.checked })} className="accent-dream" />
                        Required
                      </label>
                      <button onClick={() => setBuilderDraft({ ...builder, inputSchema: builder.inputSchema.filter((_, i) => i !== index) })} className="text-red-300 text-sm">Remove</button>
                    </div>
                  </div>
                ))}
                {builder.inputSchema.length === 0 && <p className="text-sm text-text-muted">No inputs yet.</p>}
              </div>
            </div>
            <div className="glass-panel p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="text-lg font-display font-semibold">Data Sources</h2>
                <button onClick={addDataSource} className="px-3 py-2 border border-dream/30 rounded-lg text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Add</button>
              </div>
              <div className="space-y-3">
                {builder.dataSources.map((source, index) => (
                  <div key={source.id} className="bg-void/50 border border-dream/10 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs text-text-muted">Source ID</span>
                        <input placeholder="weather-feed" value={source.id} onChange={(event) => updateDataSource(index, { id: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Source name</span>
                        <input placeholder="Weather feed" value={source.name} onChange={(event) => updateDataSource(index, { name: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Source type</span>
                        <select value={source.type} onChange={(event) => updateDataSource(index, { type: event.target.value as WorldBuilderConfig['dataSources'][number]['type'] })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2">
                          <option value="json">json</option>
                          <option value="weather">weather</option>
                          <option value="route_graph">route_graph</option>
                          <option value="custom">custom</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">HTTP method</span>
                        <select value={source.method ?? 'GET'} onChange={(event) => updateDataSource(index, { method: event.target.value as 'GET' | 'POST' })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2">
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                        </select>
                      </label>
                    </div>
                    <label className="mt-3 block">
                      <span className="text-xs text-text-muted">URL or endpoint</span>
                      <input value={source.url ?? ''} onChange={(event) => updateDataSource(index, { url: event.target.value })} placeholder="https://api.example.com/value" className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50" />
                    </label>
                    {(source.method ?? 'GET') === 'POST' && (
                      <textarea
                        value={source.requestBodyTemplate ?? ''}
                        onChange={(event) => updateDataSource(index, { requestBodyTemplate: event.target.value })}
                        placeholder={'{"name":"{{runtime.inputs.name}}"}'}
                        rows={4}
                        className="mt-3 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50"
                      />
                    )}
                    <button onClick={() => setBuilderDraft({ ...builder, dataSources: builder.dataSources.filter((_, i) => i !== index) })} className="mt-3 text-red-300 text-sm">Remove</button>
                  </div>
                ))}
                {builder.dataSources.length === 0 && <p className="text-sm text-text-muted">No data sources yet.</p>}
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 min-w-0 overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-display font-semibold">Agent and Tool Chain</h2>
                <p className="mt-1 text-xs text-text-muted">Tools run through MCP for manual live executions and pass their JSON response into the next agent.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="flex gap-2">
                  <select value={agentToAdd} onChange={(event) => setAgentToAdd(event.target.value)} className="min-w-0 bg-void border border-dream/30 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select agent</option>
                    {addableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                  <button onClick={addAgentStep} className="px-3 py-2 border border-dream/30 rounded-lg text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Agent</button>
                </div>
                <div className="flex gap-2">
                  <select value={toolToAdd} onChange={(event) => setToolToAdd(event.target.value)} className="min-w-0 bg-void border border-teal/30 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select deployed tool</option>
                    {addableTools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}
                  </select>
                  <button onClick={addToolStep} className="px-3 py-2 border border-teal/30 rounded-lg text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Tool</button>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {builder.agentChain.map((agent, index) => (
                <div key={`${agent.agentId ?? agent.id}-${index}`} className="bg-void/50 border border-dream/10 rounded-lg p-4 flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-dream/10 border border-dream/20 flex items-center justify-center text-sm font-mono text-dream">{index + 1}</div>
                  <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs text-text-muted">Step name</span>
                        <input placeholder="Agent step name" value={agent.name} onChange={(event) => updateChainStep(index, { name: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                      </label>
                      {agent.stepType === 'tool' ? (
                        <div>
                          <span className="text-xs text-text-muted">Step type</span>
                          <div className="mt-1 bg-teal/10 border border-teal/20 rounded px-3 py-2 text-sm text-teal">Tool · {agent.toolSlug ?? agent.toolId}</div>
                        </div>
                      ) : (
                        <label className="block">
                          <span className="text-xs text-text-muted">Agent type</span>
                          <select value={agent.agentType} onChange={(event) => updateChainStep(index, { agentType: event.target.value as AgentType })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2">
                            <option value="native_llm">native_llm</option>
                            <option value="native_json_api">native_json_api</option>
                            <option value="native_web_parse">native_web_parse</option>
                            <option value="reverie_custom">reverie_custom</option>
                          </select>
                        </label>
                      )}
                    </div>
                    <label className="block">
                      <span className="text-xs text-text-muted">Purpose / system instruction</span>
                      <textarea placeholder="Describe what this step should decide" value={agent.purpose} onChange={(event) => updateChainStep(index, { purpose: event.target.value })} rows={2} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    {agent.stepType === 'tool' ? (
                      <label className="block">
                        <span className="text-xs text-text-muted">Tool JSON input mapping</span>
                        <textarea
                          placeholder={'{"input":"{{previous.output}}"}'}
                          value={agent.toolInputTemplate ?? ''}
                          onChange={(event) => updateChainStep(index, { toolInputTemplate: event.target.value })}
                          rows={5}
                          className="mt-1 w-full bg-surface border border-teal/20 rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50"
                        />
                      </label>
                    ) : (
                      <label className="block">
                        <span className="text-xs text-text-muted">Agent input template</span>
                        <input placeholder="Use {{runtime.inputs.name}}, {{source.value}}, or {{previous.output}}" value={agent.inputTemplate} onChange={(event) => updateChainStep(index, { inputTemplate: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50" />
                      </label>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm text-text-muted">
                          <input type="checkbox" checked={Boolean(agent.persistResult)} onChange={(event) => updateChainStep(index, { persistResult: event.target.checked })} className="accent-dream" />
                          Persist result
                        </label>
                        {agent.stepType === 'tool' && (
                          <label className="flex items-center gap-2 text-sm text-text-muted">
                            <input type="checkbox" checked={agent.consumePreviousOutput !== false} onChange={(event) => updateChainStep(index, { consumePreviousOutput: event.target.checked })} className="accent-teal" />
                            Include previous output
                          </label>
                        )}
                      </div>
                      <button onClick={() => setBuilderDraft({ ...builder, agentChain: builder.agentChain.filter((_, i) => i !== index) })} className="text-red-300 text-sm">Remove</button>
                    </div>
                  </div>
                </div>
              ))}
              {builder.agentChain.length === 0 && <p className="text-sm text-text-muted">No agent steps yet.</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-panel p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-lg font-display font-semibold">Zones</h2>
                  <p className={`mt-1 text-xs ${zoneAllocationTotal > 100 ? 'text-red-300' : 'text-text-muted'}`}>Allocation {zoneAllocationTotal}% used.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={rebalanceZones} className="px-3 py-2 border border-dream/30 rounded-lg text-sm">Rebalance</button>
                  <button onClick={addZone} className="px-3 py-2 border border-dream/30 rounded-lg text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Add</button>
                </div>
              </div>
              {zoneAllocationTotal > 100 && <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> Zone allocation cannot exceed 100%.</div>}
              <div className="space-y-3">
                {(builder.zones ?? []).map((zone, index) => (
                  <div key={zone.id} className="bg-void/50 border border-dream/10 rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px] gap-3">
                      <label className="block">
                        <span className="text-xs text-text-muted">Zone ID</span>
                        <input placeholder="north-atlantic" value={zone.id} onChange={(event) => updateZone(index, { id: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Allocation %</span>
                        <input aria-label="Zone allocation percent" type="number" min={0} max={100} value={zone.allocationPercent ?? 0} onChange={(event) => updateZone(index, { allocationPercent: Number(event.target.value) })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2" />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-xs text-text-muted">Zone name</span>
                      <input placeholder="North Atlantic" value={zone.name} onChange={(event) => updateZone(index, { name: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-text-muted">Zone description</span>
                      <textarea placeholder="What this zone represents" value={zone.description ?? ''} onChange={(event) => updateZone(index, { description: event.target.value })} rows={2} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="block">
                        <span className="text-xs text-text-muted">Danger level</span>
                        <input aria-label="Zone danger level" type="number" min={0} max={100} value={numberValue(objectValue(zone.state).dangerLevel)} onChange={(event) => updateZoneState(index, { dangerLevel: Number(event.target.value) })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Controlling faction</span>
                        <select aria-label="Zone controlling faction" value={String(objectValue(zone.state).controllingFaction ?? '')} onChange={(event) => updateZoneState(index, { controllingFaction: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2">
                          <option value="">Unassigned</option>
                          {(builder.factions ?? []).map((faction) => <option key={faction.id} value={faction.id}>{faction.name}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Climate</span>
                        <input aria-label="Zone climate" placeholder="CALM" value={String(objectValue(zone.state).climate ?? '')} onChange={(event) => updateZoneState(index, { climate: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                      </label>
                    </div>
                    {manifestPreview.manifest?.zones?.find((item) => item.sourceId === zone.id) && (
                      <p className="text-xs text-text-muted font-mono break-all">On-chain zone ID: {manifestPreview.manifest.zones.find((item) => item.sourceId === zone.id)?.zoneId}</p>
                    )}
                    <button onClick={() => setBuilderDraft({ ...builder, zones: (builder.zones ?? []).filter((_, i) => i !== index) })} className="text-red-300 text-sm">Remove</button>
                  </div>
                ))}
                {(builder.zones ?? []).length === 0 && <p className="text-sm text-text-muted">No zones yet.</p>}
              </div>
            </div>
            <div className="glass-panel p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-lg font-display font-semibold">Factions</h2>
                  <p className={`mt-1 text-xs ${factionAllocationTotal > 100 ? 'text-red-300' : 'text-text-muted'}`}>Allocation {factionAllocationTotal}% used.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={rebalanceFactions} className="px-3 py-2 border border-dream/30 rounded-lg text-sm">Rebalance</button>
                  <button onClick={addFaction} className="px-3 py-2 border border-dream/30 rounded-lg text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Add</button>
                </div>
              </div>
              {factionAllocationTotal > 100 && <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> Faction allocation cannot exceed 100%.</div>}
              <div className="space-y-3">
                {(builder.factions ?? []).map((faction, index) => (
                  <div key={faction.id} className="bg-void/50 border border-dream/10 rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px] gap-3">
                      <label className="block">
                        <span className="text-xs text-text-muted">Faction ID</span>
                        <input placeholder="harbor-authority" value={faction.id} onChange={(event) => updateFaction(index, { id: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm placeholder:text-text-muted/50" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Allocation %</span>
                        <input aria-label="Faction allocation percent" type="number" min={0} max={100} value={faction.allocationPercent ?? 0} onChange={(event) => updateFaction(index, { allocationPercent: Number(event.target.value) })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2" />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-xs text-text-muted">Faction name</span>
                      <input placeholder="Harbor Authority" value={faction.name} onChange={(event) => updateFaction(index, { name: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-text-muted">Faction description</span>
                      <textarea placeholder="What this faction controls or reacts to" value={faction.description ?? ''} onChange={(event) => updateFaction(index, { description: event.target.value })} rows={2} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)] gap-3">
                      <label className="block">
                        <span className="text-xs text-text-muted">Morale</span>
                        <input aria-label="Faction morale baseline" type="number" min={-100} max={100} value={numberValue(objectValue(faction.state).morale, 50)} onChange={(event) => updateFactionState(index, { morale: Number(event.target.value) })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-text-muted">Narrative baseline</span>
                        <input aria-label="Faction narrative baseline" placeholder="Initial narrative" value={String(objectValue(faction.state).narrative ?? '')} onChange={(event) => updateFactionState(index, { narrative: event.target.value })} className="mt-1 w-full bg-surface border border-dream/20 rounded px-3 py-2 placeholder:text-text-muted/50" />
                      </label>
                    </div>
                    {manifestPreview.manifest?.factions?.find((item) => item.sourceId === faction.id) && (
                      <p className="text-xs text-text-muted font-mono break-all">On-chain faction ID: {manifestPreview.manifest.factions.find((item) => item.sourceId === faction.id)?.factionId}</p>
                    )}
                    <button onClick={() => setBuilderDraft({ ...builder, factions: (builder.factions ?? []).filter((_, i) => i !== index) })} className="text-red-300 text-sm">Remove</button>
                  </div>
                ))}
                {(builder.factions ?? []).length === 0 && <p className="text-sm text-text-muted">No factions yet.</p>}
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 overflow-hidden">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-display font-semibold flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-dream" /> Builder Graph
              </h2>
              <Link href={triggersUrl} className="text-sm text-teal hover:text-aurora">Manage Triggers</Link>
            </div>
            {(builder.triggers ?? []).length > 0 && (
              <div className="space-y-4 mb-5 min-w-0">
                {(builder.triggers ?? []).map((trigger) => {
                  const sourceLabel = trigger.sourceConfig?.kind
                    ? [trigger.sourceConfig.kind, trigger.sourceConfig.sourceId, trigger.sourceConfig.path].filter(Boolean).join(' / ')
                    : trigger.sourceId ?? 'source';
                  const chain = trigger.agentChain ?? [];
                  return (
                    <div key={trigger.id} className="rounded-lg border border-dream/15 bg-void/50 p-4 min-w-0">
                      <Link href={`${triggersUrl}?triggerId=${trigger.id}`} className="mb-3 block hover:text-teal transition-colors">
                        <p className="font-medium">{trigger.name}</p>
                        <p className="text-xs font-mono text-text-muted break-all">{trigger.id}</p>
                      </Link>
                      <div className="max-w-full overflow-x-auto pb-2">
                        <div className="flex w-max max-w-none items-center gap-2">
                          <span className="flex h-20 w-24 shrink-0 items-center justify-center rounded-md border border-teal/25 bg-teal/10 px-2 text-center text-[11px] font-medium text-teal">
                            Trigger
                          </span>
                          <span className="text-text-muted">-&gt;</span>
                          <span className="flex h-20 w-24 shrink-0 items-center justify-center rounded-md border border-dream/20 bg-surface px-2 text-center text-[11px] text-text-muted">
                            {sourceLabel}
                          </span>
                        {chain.map((agentId, index) => {
                          const agent = builder.agentChain.find((step) => step.id === agentId || step.agentId === agentId);
                          return (
                            <span key={`${trigger.id}:${agentId}:${index}`} className="contents">
                              <span className="text-text-muted">-&gt;</span>
                              <span className="flex h-20 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-aurora/20 bg-aurora/10 px-2 text-center text-[11px] text-aurora">
                                {agent?.name ?? agentId}
                              </span>
                            </span>
                          );
                        })}
                        <span className="text-text-muted">-&gt;</span>
                        <span className="flex h-20 w-24 shrink-0 items-center justify-center rounded-md border border-dream/20 bg-dream/10 px-2 text-center text-[11px] text-dream">
                          Faction state
                        </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {(builder.triggers ?? []).length === 0 && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {(builder.graph?.nodes ?? []).map((node) => (
                <Link
                  key={node.id}
                  href={node.type === 'trigger' && node.refId ? `${triggersUrl}?triggerId=${node.refId}` : '#'}
                  className={`rounded-lg border p-4 ${node.type === 'trigger' ? 'border-teal/25 bg-teal/10 hover:bg-teal/15' : 'border-dream/15 bg-void/50'}`}
                >
                  <p className="text-xs uppercase tracking-wider text-text-muted">{node.type}</p>
                  <p className="font-medium">{node.label}</p>
                  {node.refId && <p className="text-xs text-text-muted font-mono mt-1">{node.refId}</p>}
                </Link>
              ))}
              {(!builder.graph?.nodes || builder.graph.nodes.length === 0) && (
                <p className="text-sm text-text-muted">No graph nodes configured. Add nodes in JSON or through template presets.</p>
              )}
            </div>}
          </div>

          <div className="glass-panel p-6">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-teal" /> Server Secrets
            </h2>
            <p className="text-sm text-text-muted mb-4">Secret values are write-only. APIs return keys only.</p>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 mb-4">
              <input value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="SECRET_KEY" className="bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono" />
              <input value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Secret value" type="password" className="bg-void border border-dream/30 rounded-lg px-4 py-3" />
              <button onClick={saveSecret} disabled={!secretKey || !secretValue || secretSaving} className="px-4 py-3 bg-surface border border-dream/30 rounded-lg disabled:opacity-50">
                {secretSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {secretKeys.length === 0 ? <span className="text-sm text-text-muted">No saved secret keys.</span> : secretKeys.map((secret) => (
                <span key={secret.key} className="px-3 py-1 rounded-full bg-teal/10 border border-teal/20 text-teal text-xs font-mono">{secret.key}</span>
              ))}
            </div>
          </div>
        </div>

        <aside className="glass-panel sticky top-24 h-fit min-w-0 max-w-full overflow-hidden p-6 space-y-6">
          <div>
            <h2 className="text-lg font-display font-semibold mb-4">Live Manifest Preview</h2>
            {manifestPreview.error && <p className="mb-3 rounded border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">{manifestPreview.error}</p>}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-dream/10 bg-void/40 p-3">
                <p className="text-text-muted">Triggers</p>
                <p className="font-mono text-text-primary">{manifestPreview.manifest?.summary?.triggerCount ?? 0}</p>
              </div>
              <div className="rounded-lg border border-dream/10 bg-void/40 p-3">
                <p className="text-text-muted">Steps</p>
                <p className="font-mono text-text-primary">{manifestPreview.manifest?.summary?.stepCount ?? 0}</p>
              </div>
              <div className="rounded-lg border border-dream/10 bg-void/40 p-3">
                <p className="text-text-muted">Relationships</p>
                <p className="font-mono text-text-primary">{manifestPreview.manifest?.summary?.relationshipCount ?? manifestPreview.manifest?.relationships?.length ?? 0}</p>
              </div>
              <div className="rounded-lg border border-dream/10 bg-void/40 p-3">
                <p className="text-text-muted">Minimum STT</p>
                <p className="font-mono text-text-primary">{manifestPreview.cost?.minimumBalanceStt ?? 0}</p>
              </div>
            </div>
            {manifestPreview.manifest?.manifestHash && <p className="mt-3 break-all font-mono text-[11px] text-text-muted">Hash: {manifestPreview.manifest.manifestHash}</p>}
            {((manifestPreview.resolvedAgentUrls?.length ?? 0) > 0 || Object.keys(objectValue(manifestPreview.resolvedInputSnapshot?.dataSources)).length > 0) && (
              <details className="mt-3 rounded-lg border border-dream/15 bg-void/40 p-3 text-xs text-text-muted">
                <summary className="cursor-pointer text-text-primary">Resolved live URLs</summary>
                <div className="mt-3 space-y-2">
                  {manifestPreview.resolvedRouteProgressCoordinate && (
                    <p className="break-all">
                      <span className="text-teal">Route progress coordinate</span>: {manifestPreview.resolvedRouteProgressCoordinate.latitude}, {manifestPreview.resolvedRouteProgressCoordinate.longitude}
                    </p>
                  )}
                  {manifestPreview.resolvedAgentUrls?.map((step) => (
                    <p key={`${step.id}:${step.url}`} className="break-all">
                      <span className="text-teal">{step.name ?? step.id}</span>: {step.url}
                    </p>
                  ))}
                  {Object.entries(objectValue(manifestPreview.resolvedInputSnapshot?.dataSources)).map(([id, value]) => {
                    const source = objectValue(value);
                    return source.url ? (
                      <p key={id} className="break-all">
                        <span className="text-dream">{id}</span>: {String(source.url)}
                        {source.ok === false && <span className="text-red-300"> / {String(source.error ?? `HTTP ${source.status ?? 'failed'}`)}</span>}
                      </p>
                    ) : null;
                  })}
                  {!manifestPreview.resolvedRouteProgressCoordinate && Boolean(objectValue(manifestPreview.resolvedInputSnapshot?.dataSources).routeProgress) && (
                    <p className="text-red-300">
                      Route progress did not resolve projected latitude/longitude. Replace Cargo defaults or check start port, destination port, and speed.
                    </p>
                  )}
                </div>
              </details>
            )}
            {(manifestPreview.manifest?.unsupported ?? []).length > 0 && (
              <div className="mt-3 rounded-lg border border-yellow-400/25 bg-yellow-400/10 p-3 text-xs text-yellow-200">
                {(manifestPreview.manifest?.unsupported ?? []).map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
              </div>
            )}
            {(manifestPreview.cost?.warnings ?? []).length > 0 && (
              <div className="mt-3 rounded-lg border border-dream/15 bg-void/40 p-3 text-xs text-text-muted">
                {manifestPreview.cost?.warnings?.map((item) => <p key={item}>{item}</p>)}
              </div>
            )}
          </div>
          <div>
          <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2">
            <Braces className="w-5 h-5 text-dream" /> JSON Config
          </h2>
          <textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} rows={28} className="block w-full max-w-full overflow-x-auto bg-void border border-dream/20 rounded-lg p-3 text-xs font-mono text-text-muted" />
          <div className="flex gap-3 mt-4">
            <button onClick={applyJson} className="flex-1 py-2 bg-surface border border-dream/30 rounded-lg text-sm">Apply JSON</button>
            <a href={`data:application/json;charset=utf-8,${encodeURIComponent(jsonDraft)}`} download={`${builder.uiSlug}.builder.json`} className="flex-1 py-2 bg-surface border border-dream/30 rounded-lg text-sm text-center flex items-center justify-center gap-2">
              Export <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <p className="text-sm text-text-muted mt-4">{message}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
