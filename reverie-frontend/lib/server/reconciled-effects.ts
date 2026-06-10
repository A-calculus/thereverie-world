import 'server-only';
import type { RuntimeDecodedEvent } from '@/lib/server/live-runtime-verification';
import type { WorldBuilderConfig } from '@/lib/shared/types';

type ReconciledEffects = {
  updatedAt?: string;
  world?: Record<string, unknown>;
  zones?: Record<string, Record<string, unknown>>;
  factions?: Record<string, Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function maybeTypedValue(value: string) {
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  try {
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return JSON.parse(trimmed);
    }
  } catch {
    return value;
  }
  return value;
}

function mappingValue(template: unknown, previousResult: string) {
  const raw = stringValue(template, previousResult);
  const next = raw
    .replace(/\{\{\s*previous\.output\s*\}\}/g, previousResult)
    .replace(/\{\{\s*trigger\.result\s*\}\}/g, previousResult)
    .replace(/\{\{\s*source\.value\s*\}\}/g, new Date().toISOString());
  return maybeTypedValue(next);
}

function triggerIdMap(manifest: Record<string, unknown>) {
  const map = new Map<string, string>();
  for (const trigger of arrayValue(manifest.triggers)) {
    const compiled = stringValue(trigger.triggerId);
    const source = stringValue(trigger.sourceId);
    if (compiled && source) map.set(compiled.toLowerCase(), source);
  }
  return map;
}

function cloneEffects(value: unknown): ReconciledEffects {
  const effects = objectValue(value);
  return {
    updatedAt: stringValue(effects.updatedAt) || undefined,
    world: { ...objectValue(effects.world) },
    zones: Object.fromEntries(Object.entries(objectValue(effects.zones)).map(([key, zone]) => [key, { ...objectValue(zone) }])),
    factions: Object.fromEntries(Object.entries(objectValue(effects.factions)).map(([key, faction]) => [key, { ...objectValue(faction) }])),
    events: arrayValue(effects.events),
  };
}

export function buildReconciledEffects(params: {
  existing?: unknown;
  builder: WorldBuilderConfig;
  manifest: Record<string, unknown>;
  events: RuntimeDecodedEvent[];
  now?: string;
}) {
  const effects = cloneEffects(params.existing);
  effects.world ??= {};
  effects.zones ??= {};
  effects.factions ??= {};
  effects.events ??= [];
  const now = params.now ?? new Date().toISOString();
  const sourceByCompiledTrigger = triggerIdMap(params.manifest);
  const triggerById = new Map((params.builder.triggers ?? []).map((trigger) => [trigger.id, trigger]));
  let latestDecisionContinuation: Record<string, unknown> | null = null;

  for (const event of params.events) {
    if (event.kind === 'DecisionContinuationMatched') {
      latestDecisionContinuation = {
        triggerId: event.triggerId,
        nextTriggerId: stringValue(event.args.nextTriggerId),
        matchValue: stringValue(event.args.matchValue),
        terminal: event.args.terminal,
        transactionHash: event.transactionHash,
        updatedAt: now,
      };
      effects.world.latestDecision = stringValue(event.args.matchValue, stringValue(effects.world.latestDecision));
      continue;
    }
    if (event.kind !== 'WorkflowCompleted') continue;
    const compiledTriggerId = stringValue(event.triggerId, stringValue(event.args.triggerId)).toLowerCase();
    const sourceTriggerId = sourceByCompiledTrigger.get(compiledTriggerId);
    const trigger = sourceTriggerId ? triggerById.get(sourceTriggerId) : undefined;
    if (!trigger) continue;
    const previousResult = stringValue(event.result, stringValue(event.args.result));
    for (const mapping of trigger.outputMapping ?? []) {
      const path = mapping.path || 'latestDecision';
      const value = mappingValue(mapping.valueTemplate, previousResult);
      if (mapping.target === 'world_state') {
        effects.world[path] = value;
        continue;
      }
      if (mapping.target === 'zone' && mapping.targetId) {
        effects.zones[mapping.targetId] = {
          ...objectValue(effects.zones[mapping.targetId]),
          [path]: value,
        };
        continue;
      }
      if (mapping.target === 'faction' && mapping.targetId) {
        effects.factions[mapping.targetId] = {
          ...objectValue(effects.factions[mapping.targetId]),
          [path]: value,
        };
        continue;
      }
      if (mapping.target === 'event') {
        effects.events.unshift({
          title: mapping.targetId ?? 'World event',
          path,
          value,
          triggerId: sourceTriggerId,
          compiledTriggerId: event.triggerId,
          transactionHash: event.transactionHash,
          createdAt: now,
        });
      }
    }
  }

  effects.updatedAt = now;
  if (effects.events.length > 50) effects.events = effects.events.slice(0, 50);
  return { effects, latestDecisionContinuation };
}

export function mergeReconciledManifestState(params: {
  manifestState: { zones?: Array<Record<string, unknown>>; factions?: Array<Record<string, unknown>> } | null | undefined;
  builder: WorldBuilderConfig;
  effects?: unknown;
}) {
  const effects = cloneEffects(params.effects);
  const zoneEffects = objectValue(effects.zones);
  const factionEffects = objectValue(effects.factions);
  const builderZones = new Map((params.builder.zones ?? []).map((zone) => [zone.id, zone]));
  const builderFactions = new Map((params.builder.factions ?? []).map((faction) => [faction.id, faction]));

  return {
    zones: (params.manifestState?.zones ?? []).map((zone) => {
      const sourceId = stringValue(zone.sourceId);
      const builderZone = sourceId ? builderZones.get(sourceId) : undefined;
      const live = objectValue(zone.live);
      const state = {
        ...objectValue(builderZone?.state),
        ...live,
        ...objectValue(sourceId ? zoneEffects[sourceId] : undefined),
      };
      return {
        ...zone,
        ...state,
        live: {
          ...live,
          ...state,
        },
      };
    }),
    factions: (params.manifestState?.factions ?? []).map((faction) => {
      const sourceId = stringValue(faction.sourceId, stringValue(faction.factionId));
      const builderFaction = sourceId ? builderFactions.get(sourceId) : undefined;
      const live = objectValue(faction.live);
      const state = {
        ...objectValue(builderFaction?.state),
        ...live,
        ...objectValue(sourceId ? factionEffects[sourceId] : undefined),
      };
      return {
        ...faction,
        ...state,
        live: {
          ...live,
          ...state,
        },
      };
    }),
  };
}
