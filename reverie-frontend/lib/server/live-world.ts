import 'server-only';
import { compileWorldManifest } from '@worldframe/sdk';
import { createGenericBuilderConfig, normalizeBuilderConfig } from '@/lib/shared/world-builder/defaults';
import type { WorldBuilderConfig, WorldSummary } from '@/lib/shared/types';

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function bigintJson(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function effectiveWorldStatus(world: {
  contract_address?: string | null;
  world_state?: unknown;
  status?: WorldSummary['status'];
}): WorldSummary['status'] {
  const status = world.status ?? 'deployed';
  const state = objectValue(world.world_state);
  const runtime = objectValue(state.runtime);
  const runtimeStatus = typeof runtime.status === 'string' ? runtime.status : '';
  if (runtimeStatus === 'stopped') return 'stopped';
  if (runtimeStatus === 'running') return 'running';
  if (runtimeStatus === 'armed' || runtimeStatus === 'subscribed') return 'deployed';
  if (world.contract_address && status === 'draft') return 'deployed';
  return status;
}

export function liveWorldSummary(world: {
  id: string;
  name: string;
  contract_address?: string | null;
  template_id?: string | null;
  world_state?: unknown;
  status?: WorldSummary['status'];
  sttt_balance?: number | string;
  created_at?: string;
}): WorldSummary {
  const state = objectValue(world.world_state);
  const agents = Array.isArray(state.agents) ? state.agents.filter((item): item is string => typeof item === 'string') : [];
  return {
    id: world.id,
    name: world.name,
    contractAddress: world.contract_address ?? '',
    template: typeof state.templateSlug === 'string' ? state.templateSlug : world.template_id ?? 'Custom',
    templateSlug: typeof state.templateSlug === 'string' ? state.templateSlug : 'custom',
    status: effectiveWorldStatus(world),
    balance: `${world.sttt_balance ?? 0} STT`,
    activeAgents: agents.length,
    createdAt: world.created_at ?? new Date().toISOString(),
  };
}

export function builderFromWorld(world: { id: string; name: string; world_state?: unknown }) {
  const state = objectValue(world.world_state);
  return normalizeBuilderConfig((state.builder as WorldBuilderConfig | undefined) ?? createGenericBuilderConfig({ name: world.name, slug: world.id }));
}

export function compileSerializableManifest(builder: WorldBuilderConfig) {
  const manifest = compileWorldManifest(builder);
  return JSON.parse(JSON.stringify(manifest, bigintJson)) as Record<string, unknown>;
}
