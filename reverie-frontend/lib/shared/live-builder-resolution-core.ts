import { canonicalBaseUrl } from '@/lib/shared/base-url';
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

export function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url.startsWith('/') ? url : `/${url}`, canonicalBaseUrl()).toString();
}

function resolveUrlField(value: string, variables: Record<string, unknown>): string {
  const resolved = interpolateUrl(value, variables);
  return resolved ? absoluteUrl(resolved) : resolved;
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

async function resolveDataSource(
  source: WorldBuilderDataSource,
  sourceConfig: TriggerSourceConfig | undefined,
  variables: Record<string, unknown>,
  fetchDataSources: boolean,
) {
  if (!source.url) return withResponseAlias({ skipped: true, reason: 'No URL configured.' });
  const url = absoluteUrl(interpolateUrl(source.url, variables));
  const method = source.method ?? 'GET';
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
  if (typeof record.url === 'string') next.url = resolveUrlField(record.url, variables);
  if (typeof record.urlTemplate === 'string') next.urlTemplate = resolveUrlField(record.urlTemplate, variables);
  if (typeof record.selector === 'string') next.selector = stripUnresolvedTemplates(interpolatePlain(record.selector, variables));
  if (typeof record.prompt === 'string') next.prompt = stripUnresolvedTemplates(interpolatePlain(record.prompt, variables));
  if (typeof record.contextTemplate === 'string') next.contextTemplate = stripUnresolvedTemplates(interpolatePlain(record.contextTemplate, variables));
  if (typeof record.resultAlias === 'string') next.resultAlias = stripUnresolvedTemplates(interpolatePlain(record.resultAlias, variables));
  return next;
}

export async function resolveBuilderForManifestCore(options: ResolveOptions): Promise<{ builder: WorldBuilderConfig; snapshot: LiveResolutionSnapshot }> {
  const builder = applyLiveBuilderAgentDefaults(options.builder, options.builder.uiSlug);
  const inputs = inputDefaults(builder, options.inputs);
  const publicState = options.publicState ?? {};
  const dataSources: Record<string, unknown> = {};
  const triggerPayloads: Record<string, unknown> = {};
  const sourceSnapshots: Record<string, unknown> = {};
  const fetchDataSources = options.fetchDataSources ?? false;

  for (const source of builder.dataSources ?? []) {
    if (!source.id || dataSources[source.id]) continue;
    dataSources[source.id] = await resolveDataSource(source, undefined, {
      runtime: { inputs },
      worldState: publicState,
      dataSources,
    }, fetchDataSources);
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
      const resolved = resolveStepForTrigger(step, trigger, stepIndex, variables);
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
