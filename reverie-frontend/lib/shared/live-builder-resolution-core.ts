import { canonicalBaseUrl } from '@/lib/shared/base-url';
import { builderTemplateSlug } from '@/lib/shared/cargo-template';
import {
  buildCargoRoutePlan,
  createWeatherSample,
  getCargoRouteGraph,
  projectCargoProgress,
} from '@/lib/shared/cargo-climate/engine';
import { applyLiveAgentStepDefaults, applyLiveBuilderAgentDefaults } from '@/lib/shared/live-agent-step-defaults';
import type {
  TriggerSourceConfig,
  WorldBuilderAgentStep,
  WorldBuilderConfig,
  WorldBuilderDataSource,
  WorldBuilderTrigger,
} from '@/lib/shared/types';

export type LiveResolutionSnapshot = {
  resolvedAt: string;
  inputs: Record<string, unknown>;
  sources: Record<string, unknown>;
  dataSources: Record<string, unknown>;
  triggerPayloads: Record<string, unknown>;
};

type ResolveOptions = {
  builder: WorldBuilderConfig;
  inputs?: Record<string, unknown>;
  publicState?: Record<string, unknown>;
  fetchDataSources?: boolean;
  resolutionSource?: string;
  baseUrl?: string | URL;
};

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)];
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function interpolatePlain(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => stringifyTemplateValue(readPath(variables, rawPath.trim())));
}

function stripUnresolvedTemplates(value: string): string {
  return value.replace(/\{\{\s*[^}]+?\s*\}\}/g, '').trim();
}

export function interpolateUrl(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => encodeURIComponent(stringifyTemplateValue(readPath(variables, rawPath.trim()))));
}

function baseUrlForResolution(baseUrl?: string | URL) {
  if (baseUrl instanceof URL) return new URL(baseUrl.toString());
  if (typeof baseUrl === 'string' && baseUrl.trim()) {
    try {
      return new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
    } catch {
      return canonicalBaseUrl();
    }
  }
  return canonicalBaseUrl();
}

export function absoluteUrl(url: string, baseUrl?: string | URL): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = baseUrlForResolution(baseUrl);
  base.pathname = '/';
  base.search = '';
  base.hash = '';
  return new URL(url.startsWith('/') ? url : `/${url}`, base).toString();
}

function resolveUrlField(value: string, variables: Record<string, unknown>, baseUrl?: string | URL): string {
  const resolved = interpolateUrl(value, variables);
  return resolved ? absoluteUrl(resolved, baseUrl) : resolved;
}

function inputDefaults(builder: WorldBuilderConfig, overrides?: Record<string, unknown>) {
  return Object.fromEntries((builder.inputSchema ?? []).map((input) => [
    input.id,
    overrides && input.id in overrides ? overrides[input.id] : input.defaultValue ?? '',
  ]));
}

function withResponseAlias(snapshot: Record<string, unknown>) {
  return {
    ...snapshot,
    response: {
      ok: snapshot.ok,
      status: snapshot.status,
      url: snapshot.url,
      method: snapshot.method,
      body: snapshot.body,
      error: snapshot.error,
    },
  };
}

function dataSourceDependencyIds(source: WorldBuilderDataSource) {
  const values = [source.url, source.requestBodyTemplate].filter((value): value is string => typeof value === 'string');
  return Array.from(new Set(values.flatMap((value) => (
    Array.from(value.matchAll(/\bdataSources\.([a-zA-Z0-9_-]+)/g), (match) => match[1]).filter(Boolean)
  ))));
}

function emptyCoordinateQueryParams(url: string) {
  try {
    const parsed = new URL(url);
    return ['latitude', 'longitude', 'lat', 'lon'].filter((param) => (
      parsed.searchParams.has(param) && !parsed.searchParams.get(param)?.trim()
    ));
  } catch {
    return [];
  }
}

function stringInput(inputs: Record<string, unknown>, key: string, fallback: string) {
  const value = inputs[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberInput(inputs: Record<string, unknown>, key: string, fallback: number) {
  const value = inputs[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function searchNumber(url: string, key: string): number | undefined {
  try {
    const value = new URL(url).searchParams.get(key);
    if (value === null || !value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function cargoInputParams(variables: Record<string, unknown>, url: string) {
  const inputs = objectValue(objectValue(variables.runtime).inputs);
  let searchParams: URLSearchParams | null = null;
  try {
    searchParams = new URL(url).searchParams;
  } catch {
    searchParams = null;
  }
  const startPortId = searchParams?.get('startPortId') || stringInput(inputs, 'startPortId', 'shanghai');
  const destinationPortId = searchParams?.get('destinationPortId') || stringInput(inputs, 'destinationPortId', 'rotterdam');
  const speedKnots = Number(searchParams?.get('speedKnots') ?? numberInput(inputs, 'speedKnots', 18));
  return {
    startPortId,
    destinationPortId,
    speedKnots: Number.isFinite(speedKnots) && speedKnots > 0 ? speedKnots : 18,
  };
}

function cargoRoutePlanFromVariables(variables: Record<string, unknown>, url: string) {
  const params = cargoInputParams(variables, url);
  return buildCargoRoutePlan({
    ...params,
    includeAlternatives: true,
  });
}

function resolveCargoDemoDataSource(
  source: WorldBuilderDataSource,
  url: string,
  method: string,
  variables: Record<string, unknown>,
) {
  const isCargoUrl = url.includes('/api/demo/cargo-climate/');
  const isCargoSource = isCargoUrl || ['routeGraph', 'routePlan', 'routeProgress', 'weatherSample'].includes(source.id);
  if (!isCargoSource) return null;

  try {
    if (source.id === 'routeGraph' || source.type === 'route_graph' || url.includes('/cargo-climate/routes')) {
      const graph = getCargoRouteGraph();
      const defaultPlan = buildCargoRoutePlan({
        startPortId: 'shanghai',
        destinationPortId: 'rotterdam',
        speedKnots: 18,
        includeAlternatives: true,
      });
      return withResponseAlias({
        ok: true,
        status: 200,
        url,
        method,
        body: {
          graph: {
            ...graph,
            routeAlternatives: defaultPlan.alternatives,
            corridorIds: Array.from(new Set(graph.edges.map((edge) => edge.zoneId))),
            chokepoints: graph.waypoints.filter((waypoint) => waypoint.kind === 'chokepoint'),
          },
          source: 'static-json-local',
        },
      });
    }

    if (source.id === 'routePlan' || source.type === 'route_plan' || url.includes('/cargo-climate/route-plan')) {
      return withResponseAlias({
        ok: true,
        status: 200,
        url,
        method,
        body: {
          routePlan: cargoRoutePlanFromVariables(variables, url),
          source: 'static-json-local',
        },
      });
    }

    if (source.id === 'routeProgress' || source.type === 'route_progress' || url.includes('/cargo-climate/progress')) {
      const routePlan = cargoRoutePlanFromVariables(variables, url);
      const progress = projectCargoProgress(routePlan, {
        hoursAhead: searchNumber(url, 'hours') ?? 2,
        distanceTravelledNm: searchNumber(url, 'distanceTravelledNm') ?? 0,
      });
      return withResponseAlias({
        ok: true,
        status: 200,
        url,
        method,
        body: {
          progress,
          routePlan,
          source: 'static-json-local',
        },
      });
    }

    if (source.id === 'weatherSample' || url.includes('/cargo-climate/weather-sample')) {
      const routeProgress = objectValue(readPath(variables, 'dataSources.routeProgress.body.progress'));
      const projected = objectValue(routeProgress.projectedPosition);
      const latitude = searchNumber(url, 'lat') ?? Number(projected.latitude);
      const longitude = searchNumber(url, 'lon') ?? Number(projected.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return withResponseAlias({
          ok: false,
          status: 422,
          url,
          method,
          error: 'Route progress did not resolve projected latitude/longitude. Check start port, destination port, speed, and route API status.',
        });
      }
      const hourOffset = searchNumber(url, 'hourOffset') ?? 2;
      const weather = createWeatherSample({
        hourOffset,
        latitude,
        longitude,
        distanceFromStartNm: Number(routeProgress.distanceTravelledNm ?? 0),
        lane: typeof routeProgress.currentSegment === 'object' && routeProgress.currentSegment
          ? String((routeProgress.currentSegment as Record<string, unknown>).lane ?? 'public-demo-weather')
          : 'public-demo-weather',
        zoneId: typeof routeProgress.projectedPosition === 'object' && routeProgress.projectedPosition
          ? String((routeProgress.projectedPosition as Record<string, unknown>).zoneId ?? 'public-demo-weather')
          : 'public-demo-weather',
      });
      return withResponseAlias({
        ok: true,
        status: 200,
        url,
        method,
        body: {
          ...weather,
          weather,
          source: 'static-json-local',
        },
      });
    }
  } catch (error) {
    return withResponseAlias({
      ok: false,
      status: 400,
      url,
      method,
      error: error instanceof Error ? error.message : 'Unable to resolve Cargo demo data source.',
    });
  }

  return null;
}

async function resolveDataSource(
  source: WorldBuilderDataSource,
  sourceConfig: TriggerSourceConfig | undefined,
  variables: Record<string, unknown>,
  fetchDataSources: boolean,
  baseUrl?: string | URL,
) {
  if (!source.url) return withResponseAlias({ skipped: true, reason: 'No URL configured.' });
  const url = absoluteUrl(interpolateUrl(source.url, variables), baseUrl);
  const method = source.method ?? 'GET';
  const cargoSnapshot = resolveCargoDemoDataSource(source, url, method, variables);
  if (cargoSnapshot) return cargoSnapshot;
  const emptyParams = emptyCoordinateQueryParams(url);
  if (emptyParams.length > 0) {
    return withResponseAlias({
      ok: false,
      url,
      method,
      error: `URL query value(s) are empty: ${emptyParams.join(', ')}.`,
    });
  }
  if (!fetchDataSources) return withResponseAlias({ skipped: true, url, method, reason: 'Preview resolution did not fetch the data source.' });

  const init: RequestInit = { method };
  const bodyTemplate = sourceConfig?.requestBodyTemplate ?? source.requestBodyTemplate;
  if (method === 'POST' && bodyTemplate) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = interpolatePlain(bodyTemplate, variables);
  }
  try {
    const response = await fetch(url, init);
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    return withResponseAlias({ ok: response.ok, status: response.status, url, method, body });
  } catch (error) {
    return withResponseAlias({ ok: false, url, method, error: error instanceof Error ? error.message : 'Data source request failed.' });
  }
}

function sourceValue(
  builder: WorldBuilderConfig,
  trigger: WorldBuilderTrigger,
  inputs: Record<string, unknown>,
  publicState: Record<string, unknown>,
  dataSources: Record<string, unknown>,
) {
  const condition = objectValue(trigger.condition);
  const config = trigger.sourceConfig ?? condition.sourceConfig as TriggerSourceConfig | undefined;
  if (!config) return { config, value: undefined, raw: undefined };
  if (config.kind === 'builder_input') return { config, value: readPath(inputs, config.sourceId ?? config.path), raw: inputs };
  if (config.kind === 'manual_payload') return { config, value: readPath({}, config.path), raw: {} };
  if (config.kind === 'runtime_state') return { config, value: readPath(publicState, config.path), raw: publicState };
  if (config.kind === 'schedule_time') {
    const typeConfig = objectValue(trigger.typeConfig ?? condition.typeConfig);
    const raw = {
      now: new Date().toISOString(),
      cron: typeConfig.cronExpression,
      timestampMs: typeConfig.scheduleTimestampMs ?? Date.now(),
    };
    return { config, value: readPath(raw, config.path ?? 'now'), raw };
  }
  if (config.kind === 'zone_state') {
    const zones = Array.isArray(publicState.zones) ? publicState.zones : builder.zones ?? [];
    const zone = zones.find((item) => item && typeof item === 'object' && (item as { id?: string }).id === config.sourceId);
    return { config, value: readPath(zone, config.path), raw: zone };
  }
  if (config.kind === 'faction_state') {
    const factions = Array.isArray(publicState.factions) ? publicState.factions : builder.factions ?? [];
    const faction = factions.find((item) => item && typeof item === 'object' && (item as { id?: string }).id === config.sourceId);
    return { config, value: readPath(faction, config.path), raw: faction };
  }
  if (config.kind === 'data_source') {
    const raw = config.sourceId ? dataSources[config.sourceId] : undefined;
    return { config, value: readPath(raw, config.path), raw };
  }
  return { config, value: undefined, raw: undefined };
}

function parsePayload(trigger: WorldBuilderTrigger, variables: Record<string, unknown>) {
  const condition = objectValue(trigger.condition);
  const typeConfig = objectValue(trigger.typeConfig ?? condition.typeConfig);
  const rawTemplate = typeof trigger.inputParser === 'string' && trigger.inputParser.trim()
    ? trigger.inputParser
    : typeof typeConfig.payloadTemplate === 'string' && typeConfig.payloadTemplate.trim()
      ? typeConfig.payloadTemplate
      : '{"source": "{{source.value}}", "inputs": "{{runtime.inputs}}"}';
  const mapped = interpolatePlain(rawTemplate, variables);
  try {
    return JSON.parse(mapped);
  } catch {
    return mapped;
  }
}

function resolveStepForTrigger(
  step: WorldBuilderAgentStep,
  trigger: WorldBuilderTrigger,
  index: number,
  variables: Record<string, unknown>,
  baseUrl?: string | URL,
): WorldBuilderAgentStep {
  const resolvedId = `${step.id}__${trigger.id}__${index}`;
  const defaultedStep = applyLiveAgentStepDefaults(step, String(objectValue(variables.runtime).slug ?? 'custom'));
  const record = defaultedStep as WorldBuilderAgentStep & Record<string, unknown>;
  const next: WorldBuilderAgentStep & Record<string, unknown> = {
    ...record,
    id: resolvedId,
    sourceStepId: step.id,
    agentId: defaultedStep.agentId,
    inputTemplate: stripUnresolvedTemplates(interpolatePlain(defaultedStep.inputTemplate || '{{trigger.payload}}', variables)),
    purpose: stripUnresolvedTemplates(interpolatePlain(defaultedStep.purpose || '', variables)),
  };
  if (typeof defaultedStep.toolInputTemplate === 'string') next.toolInputTemplate = stripUnresolvedTemplates(interpolatePlain(defaultedStep.toolInputTemplate, variables));
  if (typeof record.systemPrompt === 'string') next.systemPrompt = stripUnresolvedTemplates(interpolatePlain(record.systemPrompt, variables));
  if (typeof record.url === 'string') next.url = resolveUrlField(record.url, variables, baseUrl);
  if (typeof record.urlTemplate === 'string') next.urlTemplate = resolveUrlField(record.urlTemplate, variables, baseUrl);
  if (typeof record.selector === 'string') next.selector = stripUnresolvedTemplates(interpolatePlain(record.selector, variables));
  if (typeof record.prompt === 'string') next.prompt = stripUnresolvedTemplates(interpolatePlain(record.prompt, variables));
  if (typeof record.contextTemplate === 'string') next.contextTemplate = stripUnresolvedTemplates(interpolatePlain(record.contextTemplate, variables));
  if (typeof record.resultAlias === 'string') next.resultAlias = stripUnresolvedTemplates(interpolatePlain(record.resultAlias, variables));
  return next;
}

export async function resolveBuilderForManifestCore(options: ResolveOptions): Promise<{ builder: WorldBuilderConfig; snapshot: LiveResolutionSnapshot }> {
  const builder = applyLiveBuilderAgentDefaults(options.builder, builderTemplateSlug(options.builder));
  const inputs = inputDefaults(builder, options.inputs);
  const publicState = options.publicState ?? {};
  const dataSources: Record<string, unknown> = {};
  const triggerPayloads: Record<string, unknown> = {};
  const sourceSnapshots: Record<string, unknown> = {};
  const fetchDataSources = options.fetchDataSources ?? false;
  const baseUrl = options.baseUrl;

  const pendingSources = [...(builder.dataSources ?? [])];
  while (pendingSources.length > 0) {
    const readyIndex = pendingSources.findIndex((source) => (
      !source.id ||
      dataSources[source.id] ||
      dataSourceDependencyIds(source).every((id) => Boolean(dataSources[id]))
    ));
    if (readyIndex < 0) {
      for (const source of pendingSources.splice(0)) {
        if (!source.id || dataSources[source.id]) continue;
        const missing = dataSourceDependencyIds(source).filter((id) => !dataSources[id]);
        dataSources[source.id] = withResponseAlias({
          ok: false,
          skipped: true,
          url: source.url ? absoluteUrl(interpolateUrl(source.url, {
            runtime: { inputs },
            worldState: publicState,
            dataSources,
          }), baseUrl) : undefined,
          method: source.method ?? 'GET',
          error: `Data source dependencies not resolved: ${missing.join(', ')}.`,
        });
      }
      break;
    }
    const [source] = pendingSources.splice(readyIndex, 1);
    if (!source.id || dataSources[source.id]) continue;
    dataSources[source.id] = await resolveDataSource(source, undefined, {
      runtime: { inputs },
      worldState: publicState,
      dataSources,
    }, fetchDataSources, baseUrl);
  }

  const resolvedDataSourceConfigs = (builder.dataSources ?? []).map((source) => {
    const resolved = source.id ? objectValue(dataSources[source.id]) : {};
    const url = typeof resolved.url === 'string' && resolved.url ? resolved.url : source.url;
    const method = typeof resolved.method === 'string' && resolved.method ? resolved.method as WorldBuilderDataSource['method'] : source.method;
    return { ...source, url, method };
  });

  const resolvedSteps: WorldBuilderAgentStep[] = [];
  const resolvedTriggers = (builder.triggers ?? []).map((trigger) => {
    const source = sourceValue(builder, trigger, inputs, publicState, dataSources);
    const baseVariables: Record<string, unknown> = {
      runtime: { inputs, actionId: trigger.id, slug: builder.uiSlug },
      worldState: publicState,
      dataSources,
      source: { config: source.config, value: source.value, raw: source.raw },
      previous: { input: null, output: null },
      agents: {},
      trigger: { id: trigger.id, name: trigger.name, type: trigger.type, payload: {} },
    };
    const payload = parsePayload(trigger, baseVariables);
    const variables = {
      ...baseVariables,
      trigger: { id: trigger.id, name: trigger.name, type: trigger.type, payload },
    };
    triggerPayloads[trigger.id] = payload;
    sourceSnapshots[trigger.id] = source;

    const chain = (trigger.agentChain ?? []).map((stepId, stepIndex) => {
      const step = builder.agentChain.find((item) => item.id === stepId || item.agentId === stepId || item.toolId === stepId);
      if (!step) return stepId;
      const resolved = resolveStepForTrigger(step, trigger, stepIndex, variables, baseUrl);
      resolvedSteps.push(resolved);
      return resolved.id;
    });
    return { ...trigger, agentChain: chain };
  });

  return {
    builder: {
      ...builder,
      dataSources: resolvedDataSourceConfigs,
      triggers: resolvedTriggers,
      agentChain: resolvedSteps.length > 0 ? resolvedSteps : builder.agentChain,
      config: {
        ...(builder.config ?? {}),
        liveResolution: {
          resolvedAt: new Date().toISOString(),
          source: options.resolutionSource ?? 'manifest_resolution',
        },
      },
    },
    snapshot: {
      resolvedAt: new Date().toISOString(),
      inputs,
      sources: sourceSnapshots,
      dataSources,
      triggerPayloads,
    },
  };
}
