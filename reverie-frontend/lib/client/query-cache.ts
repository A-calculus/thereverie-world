'use client';

import type { AgentSummary, TemplateSummary, ToolSummary, WorldSummary } from '@/lib/shared/types';
import type { User } from '@/lib/auth/store';

export const CLIENT_CACHE_REFRESH_MS = 5 * 60 * 1000;
export const CLIENT_CACHE_MAX_IDLE_MS = 10 * 60 * 1000;

type CacheKey =
  | 'profile'
  | 'agents'
  | 'worlds'
  | 'templates'
  | 'tools'
  | `agent:${string}`
  | `world:${string}`
  | `template:${string}`
  | `tool:${string}`;

interface CacheEntry<T> {
  value: T;
  updatedAt: number;
  lastUsedAt: number;
}

type CacheStore = Record<string, CacheEntry<unknown>>;

const STORAGE_KEY = 'reverie-client-cache-v1';
const SYNC_KEY = 'reverie-client-sync-v1';
const MAX_CACHE_BYTES = 4_250_000;

type SyncEntity = 'agent' | 'world' | 'template' | 'tool';

interface SyncItem {
  entity: SyncEntity;
  id: string;
  updatedAt: number;
}

type SyncStore = Record<string, SyncItem>;

export interface ClientBootstrapSnapshot {
  profile?: User | null;
  agents?: AgentSummary[];
  worlds?: WorldSummary[];
  templates?: TemplateSummary[];
  tools?: ToolSummary[];
  source?: 'supabase' | 'demo' | 'sdk' | string;
}

function now() {
  return Date.now();
}

function readStore(): CacheStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as CacheStore : {};
  } catch {
    return {};
  }
}

function cacheByteSize(store: CacheStore) {
  return new Blob([JSON.stringify(store)]).size;
}

function isDetailCacheKey(key: string) {
  return key.startsWith('agent:')
    || key.startsWith('world:')
    || key.startsWith('template:')
    || key.startsWith('tool:');
}

function pruneStoreForQuota(store: CacheStore, protectedKey?: string) {
  const next: CacheStore = { ...store };
  const timestamp = now();
  for (const [key, entry] of Object.entries(next)) {
    if (key !== protectedKey && timestamp - entry.lastUsedAt > CLIENT_CACHE_MAX_IDLE_MS) {
      delete next[key];
    }
  }

  const detailEntries = Object.entries(next)
    .filter(([key]) => key !== protectedKey && isDetailCacheKey(key))
    .sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt);

  while (cacheByteSize(next) > MAX_CACHE_BYTES && detailEntries.length > 0) {
    const [key] = detailEntries.shift()!;
    delete next[key];
  }

  if (cacheByteSize(next) > MAX_CACHE_BYTES) {
    for (const [key] of Object.entries(next)) {
      if (key !== protectedKey && isDetailCacheKey(key)) delete next[key];
    }
  }

  return next;
}

function writeStore(store: CacheStore, protectedKey?: string) {
  if (typeof window === 'undefined') return;
  const compacted = cacheByteSize(store) > MAX_CACHE_BYTES ? pruneStoreForQuota(store, protectedKey) : store;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted));
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
    const pruned = pruneStoreForQuota(compacted, protectedKey);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    } catch {
      const listsOnly = Object.fromEntries(
        Object.entries(pruned).filter(([key]) => key === protectedKey || !isDetailCacheKey(key)),
      ) as CacheStore;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(listsOnly));
      } catch {
        // localStorage is best-effort. Server APIs remain the source of truth.
      }
    }
  }
}

function readSyncStore(): SyncStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    return raw ? JSON.parse(raw) as SyncStore : {};
  } catch {
    return {};
  }
}

function writeSyncStore(store: SyncStore) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SYNC_KEY, JSON.stringify(store));
}

function queueSync(entity: SyncEntity, id: string) {
  const store = readSyncStore();
  store[`${entity}:${id}`] = { entity, id, updatedAt: now() };
  writeSyncStore(store);
}

function removeSync(entity: SyncEntity, id: string) {
  const store = readSyncStore();
  delete store[`${entity}:${id}`];
  writeSyncStore(store);
}

export function pruneClientCache() {
  const store = readStore();
  const timestamp = now();
  let changed = false;

  for (const [key, entry] of Object.entries(store)) {
    if (timestamp - entry.lastUsedAt > CLIENT_CACHE_MAX_IDLE_MS) {
      delete store[key];
      changed = true;
    }
  }

  if (changed) writeStore(store);
}

export function getCachedValue<T>(key: CacheKey): T | undefined {
  pruneClientCache();
  const store = readStore();
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry) return undefined;

  const timestamp = now();
  if (timestamp - entry.lastUsedAt > CLIENT_CACHE_MAX_IDLE_MS) {
    delete store[key];
    writeStore(store);
    return undefined;
  }

  entry.lastUsedAt = timestamp;
  store[key] = entry as CacheEntry<unknown>;
  writeStore(store);
  return entry.value;
}

export function getFreshCachedValue<T>(key: CacheKey): T | undefined {
  const store = readStore();
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry) return undefined;

  const timestamp = now();
  if (timestamp - entry.lastUsedAt > CLIENT_CACHE_MAX_IDLE_MS) {
    delete store[key];
    writeStore(store);
    return undefined;
  }
  if (timestamp - entry.updatedAt > CLIENT_CACHE_REFRESH_MS) return undefined;

  entry.lastUsedAt = timestamp;
  store[key] = entry as CacheEntry<unknown>;
  writeStore(store);
  return entry.value;
}

export function setCachedValue<T>(key: CacheKey, value: T) {
  const store = readStore();
  const timestamp = now();
  store[key] = {
    value,
    updatedAt: timestamp,
    lastUsedAt: timestamp,
  };
  writeStore(store, key);
}

export function removeCachedValue(key: CacheKey) {
  const store = readStore();
  delete store[key];
  writeStore(store);
}

export function mergeById<T extends { id: string }>(local: T[] | undefined, upstream: T[]): T[] {
  if (!local?.length) return upstream;
  const seen = new Set(upstream.map((item) => item.id));
  return [...local.filter((item) => !seen.has(item.id)), ...upstream];
}

function entityForListKey(listKey: Extract<CacheKey, 'agents' | 'worlds' | 'templates' | 'tools'>): SyncEntity {
  if (listKey === 'agents') return 'agent';
  if (listKey === 'worlds') return 'world';
  if (listKey === 'templates') return 'template';
  return 'tool';
}

export function mergePendingLocalById<T extends { id: string }>(
  listKey: Extract<CacheKey, 'agents' | 'worlds' | 'templates' | 'tools'>,
  local: T[] | undefined,
  upstream: T[],
): T[] {
  if (!local?.length) return upstream;
  const syncStore = readSyncStore();
  const entity = entityForListKey(listKey);
  const upstreamIds = new Set(upstream.map((item) => item.id));
  const pending = local.filter((item) => syncStore[`${entity}:${item.id}`] && !upstreamIds.has(item.id));
  return [...pending, ...upstream];
}

function compactWorldSummary(world: WorldSummary): WorldSummary {
  return {
    id: world.id,
    name: world.name,
    contractAddress: world.contractAddress ?? '',
    template: world.template,
    templateSlug: world.templateSlug,
    status: world.status,
    balance: world.balance,
    activeAgents: world.activeAgents,
    createdAt: world.createdAt,
  };
}

export async function fetchCachedList<T extends { id: string }>(options: {
  listKey: Extract<CacheKey, 'agents' | 'worlds' | 'templates' | 'tools'>;
  detailKey: (id: string) => CacheKey;
  endpoint: string;
  responseKey: string;
  fallback: T[];
}): Promise<T[]> {
  const fresh = getFreshCachedValue<T[]>(options.listKey);
  if (fresh !== undefined) return fresh;

  const cached = getCachedValue<T[]>(options.listKey);
  await flushClientCacheToServer();
  const res = await fetch(options.endpoint);
  if (!res.ok) throw new Error(`Failed to fetch ${options.listKey}`);
  const data = await res.json();
  const upstream = Array.isArray(data[options.responseKey])
    ? data[options.responseKey] as T[]
    : data.source === 'demo'
      ? options.fallback
      : [];
  const items = mergePendingLocalById(options.listKey, cached, upstream);
  setCachedValue(options.listKey, items);
  for (const item of items) setCachedValue(options.detailKey(item.id), item);
  return items;
}

export function updateCachedProfile(profile: Record<string, unknown>) {
  const current = getCachedValue<Record<string, unknown>>('profile');
  if (!current) return;
  setCachedValue('profile', { ...current, ...profile });
}

export function upsertCachedAgent(agent: AgentSummary) {
  const current = getCachedValue<AgentSummary[]>('agents');
  if (!current) {
    setCachedValue('agents', [agent]);
    setCachedValue(`agent:${agent.id}`, agent);
    if (!agent.isOfficial) queueSync('agent', agent.id);
    return;
  }

  const next = [agent, ...current.filter((item) => item.id !== agent.id)];
  setCachedValue('agents', next);
  setCachedValue(`agent:${agent.id}`, agent);
  if (!agent.isOfficial) queueSync('agent', agent.id);
}

export function cacheServerAgent(agent: AgentSummary) {
  const current = getCachedValue<AgentSummary[]>('agents');
  const next = current
    ? [agent, ...current.filter((item) => item.id !== agent.id)]
    : [agent];
  setCachedValue('agents', next);
  setCachedValue(`agent:${agent.id}`, agent);
  removeSync('agent', agent.id);
}

export function cacheServerAgents(agents: AgentSummary[]) {
  const current = getCachedValue<AgentSummary[]>('agents') ?? [];
  const incomingIds = new Set(agents.map((agent) => agent.id));
  const next = [...agents, ...current.filter((agent) => !incomingIds.has(agent.id))];
  setCachedValue('agents', next);
  for (const agent of agents) {
    setCachedValue(`agent:${agent.id}`, agent);
    removeSync('agent', agent.id);
  }
}

export function removeCachedAgents(agentIds: string[]) {
  if (agentIds.length === 0) return;
  const deleted = new Set(agentIds);
  const current = getCachedValue<AgentSummary[]>('agents');
  if (current) setCachedValue('agents', current.filter((agent) => !deleted.has(agent.id)));
  const store = readStore();
  for (const agentId of agentIds) {
    delete store[`agent:${agentId}`];
    removeSync('agent', agentId);
  }
  writeStore(store);
}

export function upsertCachedWorld(world: WorldSummary) {
  const compactWorld = compactWorldSummary(world);
  const current = getCachedValue<WorldSummary[]>('worlds');
  if (!current) {
    setCachedValue('worlds', [compactWorld]);
    setCachedValue(`world:${compactWorld.id}`, compactWorld);
    queueSync('world', compactWorld.id);
    return;
  }

  const next = [compactWorld, ...current.filter((item) => item.id !== compactWorld.id).map(compactWorldSummary)];
  setCachedValue('worlds', next);
  setCachedValue(`world:${compactWorld.id}`, compactWorld);
  queueSync('world', compactWorld.id);
}

export function cacheServerWorld(world: WorldSummary) {
  const compactWorld = compactWorldSummary(world);
  const current = getCachedValue<WorldSummary[]>('worlds');
  const next = current
    ? [compactWorld, ...current.filter((item) => item.id !== compactWorld.id).map(compactWorldSummary)]
    : [compactWorld];
  setCachedValue('worlds', next);
  setCachedValue(`world:${compactWorld.id}`, compactWorld);
  removeSync('world', compactWorld.id);
}

export function cacheServerWorlds(worlds: WorldSummary[]) {
  const compactWorlds = worlds.map(compactWorldSummary);
  setCachedValue('worlds', compactWorlds);
  for (const world of compactWorlds) {
    setCachedValue(`world:${world.id}`, world);
    removeSync('world', world.id);
  }
}

export function removeCachedWorld(worldId: string) {
  const current = getCachedValue<WorldSummary[]>('worlds');
  if (current) setCachedValue('worlds', current.filter((world) => world.id !== worldId));
  const store = readStore();
  delete store[`world:${worldId}`];
  writeStore(store);
  removeSync('world', worldId);
}

export function upsertCachedTemplate(template: TemplateSummary) {
  const current = getCachedValue<TemplateSummary[]>('templates');
  if (!current) {
    setCachedValue('templates', [template]);
    setCachedValue(`template:${template.id}`, template);
    queueSync('template', template.id);
    return;
  }
  const next = [template, ...current.filter((item) => item.id !== template.id)];
  setCachedValue('templates', next);
  setCachedValue(`template:${template.id}`, template);
  queueSync('template', template.id);
}

export function upsertCachedTool(tool: ToolSummary) {
  const current = getCachedValue<ToolSummary[]>('tools');
  const next = current
    ? [tool, ...current.filter((item) => item.id !== tool.id)]
    : [tool];
  setCachedValue('tools', next);
  setCachedValue(`tool:${tool.id}`, tool);
  queueSync('tool', tool.id);
}

export function cacheServerTool(tool: ToolSummary) {
  const current = getCachedValue<ToolSummary[]>('tools');
  const next = current
    ? [tool, ...current.filter((item) => item.id !== tool.id)]
    : [tool];
  setCachedValue('tools', next);
  setCachedValue(`tool:${tool.id}`, tool);
  removeSync('tool', tool.id);
}

export function cacheServerTools(tools: ToolSummary[]) {
  setCachedValue('tools', tools);
  for (const tool of tools) {
    setCachedValue(`tool:${tool.id}`, tool);
    removeSync('tool', tool.id);
  }
}

export function removeCachedTool(toolId: string) {
  const current = getCachedValue<ToolSummary[]>('tools');
  if (current) setCachedValue('tools', current.filter((tool) => tool.id !== toolId));
  const store = readStore();
  delete store[`tool:${toolId}`];
  writeStore(store);
  removeSync('tool', toolId);
}

async function pushAgent(agent: AgentSummary) {
  return fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: agent.name,
      agentType: agent.type,
      description: agent.description,
      config: agent.config ?? {},
      systemPrompt: agent.systemPrompt ?? null,
      status: agent.status,
      isPublic: Boolean(agent.isPublic),
    }),
  });
}

async function pushWorld(world: WorldSummary) {
  return fetch('/api/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: world.name,
      contractAddress: world.contractAddress,
      templateId: world.templateSlug,
      worldState: {
        cachedSummary: world,
      },
    }),
  });
}

async function pushTemplate(template: TemplateSummary) {
  return fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: template.slug,
      name: template.name,
      description: template.description,
      category: template.category,
      tags: template.tags,
      features: template.features,
      isPublic: template.isPublic ?? template.featured,
      worldConfig: {
        cachedSummary: template,
      },
    }),
  });
}

async function pushTool(tool: ToolSummary) {
  return fetch('/api/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: tool.name,
      slug: tool.slug,
      description: tool.description,
      dependencies: tool.dependencies,
      inputSample: tool.inputSample,
      expectedOutput: tool.expectedOutput,
      mcpMetadata: tool.mcpMetadata ?? {},
      status: tool.status,
    }),
  });
}

export async function flushClientCacheToServer() {
  if (typeof window === 'undefined') return;
  const syncStore = readSyncStore();
  const items = Object.values(syncStore).sort((a, b) => a.updatedAt - b.updatedAt);
  for (const item of items) {
    try {
      let response: Response | null = null;
      if (item.entity === 'agent') {
        const agent = getCachedValue<AgentSummary>(`agent:${item.id}`);
        if (!agent || agent.isOfficial) {
          removeSync(item.entity, item.id);
          continue;
        }
        response = await pushAgent(agent);
      } else if (item.entity === 'world') {
        const world = getCachedValue<WorldSummary>(`world:${item.id}`);
        if (!world) {
          removeSync(item.entity, item.id);
          continue;
        }
        response = await pushWorld(world);
      } else if (item.entity === 'template') {
        const template = getCachedValue<TemplateSummary>(`template:${item.id}`);
        if (!template) {
          removeSync(item.entity, item.id);
          continue;
        }
        response = await pushTemplate(template);
      } else if (item.entity === 'tool') {
        const tool = getCachedValue<ToolSummary>(`tool:${item.id}`);
        if (!tool) {
          removeSync(item.entity, item.id);
          continue;
        }
        response = await pushTool(tool);
      }

      if (response?.ok || response?.status === 409) {
        removeSync(item.entity, item.id);
      }
    } catch {
      // Keep the item queued for the next automatic or action-triggered sync.
    }
  }
}

export function hydrateClientCache(snapshot: ClientBootstrapSnapshot) {
  if (snapshot.profile !== undefined) setCachedValue('profile', snapshot.profile);

  if (Array.isArray(snapshot.agents)) {
    const cached = getCachedValue<AgentSummary[]>('agents');
    const agents = mergePendingLocalById('agents', cached, snapshot.agents);
    setCachedValue('agents', agents);
    for (const agent of agents) setCachedValue(`agent:${agent.id}`, agent);
  }

  if (Array.isArray(snapshot.worlds)) {
    const cached = getCachedValue<WorldSummary[]>('worlds');
    const worlds = mergePendingLocalById('worlds', cached, snapshot.worlds).map(compactWorldSummary);
    setCachedValue('worlds', worlds);
    for (const world of worlds) setCachedValue(`world:${world.id}`, world);
  }

  if (Array.isArray(snapshot.templates)) {
    const cached = getCachedValue<TemplateSummary[]>('templates');
    const templates = mergePendingLocalById('templates', cached, snapshot.templates);
    setCachedValue('templates', templates);
    for (const template of templates) setCachedValue(`template:${template.id}`, template);
  }

  if (Array.isArray(snapshot.tools)) {
    const cached = getCachedValue<ToolSummary[]>('tools');
    const tools = mergePendingLocalById('tools', cached, snapshot.tools);
    setCachedValue('tools', tools);
    for (const tool of tools) setCachedValue(`tool:${tool.id}`, tool);
  }
}

export async function bootstrapClientCacheFromServer(): Promise<ClientBootstrapSnapshot | null> {
  if (typeof window === 'undefined') return null;
  await flushClientCacheToServer();
  const response = await fetch('/api/sync/bootstrap', { cache: 'no-store' }).catch(() => null);
  if (!response?.ok) return null;
  const snapshot = await response.json() as ClientBootstrapSnapshot;
  hydrateClientCache(snapshot);
  return snapshot;
}

export function clearClientCache() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(SYNC_KEY);
}
