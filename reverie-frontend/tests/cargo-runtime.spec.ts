import { expect, test } from '@playwright/test';
import { compileWorldManifest } from '@worldframe/sdk/browser';
import officialTemplate from '../content/official-templates/cargo-climate-guard.json';
import type { WorldBuilderConfig } from '../lib/shared/types';
import { buildCargoRoutePlan, projectCargoProgress } from '../lib/shared/cargo-climate/engine';
import { executeTriggerFlow } from '../lib/shared/world-runtime/trigger-flow';
import { resolveBuilderForManifestCore } from '../lib/shared/live-builder-resolution-core';

const builder = officialTemplate as WorldBuilderConfig;

function resolvedCargoBuilder(overrides: Partial<WorldBuilderConfig> = {}): WorldBuilderConfig {
  const replaceTemplate = (value: string) => value.replace(/\{\{\s*[^}]+?\s*\}\}/g, 'resolved');
  return {
    ...builder,
    ...overrides,
    dataSources: (overrides.dataSources ?? builder.dataSources).map((source) => ({
      ...source,
      url: source.id === 'weatherSample'
        ? 'https://api.open-meteo.com/v1/forecast?latitude=1.29&longitude=103.85&current=temperature_2m,wind_speed_10m,precipitation,weather_code'
        : `https://lvh.me:3000${source.url?.startsWith('/') ? source.url : `/${source.url ?? ''}`}`.replace(/\{\{\s*[^}]+?\s*\}\}/g, 'resolved'),
    })),
    agentChain: (overrides.agentChain ?? builder.agentChain).map((step) => ({
      ...step,
      inputTemplate: step.inputTemplate ? replaceTemplate(step.inputTemplate) : step.inputTemplate,
      contextTemplate: step.contextTemplate ? replaceTemplate(step.contextTemplate) : step.contextTemplate,
      systemPrompt: typeof (step as unknown as Record<string, unknown>).systemPrompt === 'string'
        ? replaceTemplate((step as unknown as Record<string, string>).systemPrompt)
        : (step as unknown as Record<string, unknown>).systemPrompt,
      urlTemplate: step.urlTemplate && /\{\{\s*[^}]+?\s*\}\}/.test(step.urlTemplate)
        ? 'https://api.open-meteo.com/v1/forecast?latitude=1.29&longitude=103.85&current=temperature_2m,wind_speed_10m,precipitation,weather_code'
        : step.urlTemplate,
    })),
  };
}

test('official Cargo seed uses generic trigger flow with manual, start, and autonomous tick triggers', () => {
  const triggers = builder.triggers ?? [];
  expect(builder.engine).toBe('genericEventWorld');
  expect(builder.config?.sourceTemplateSlug).toBe('cargo-climate-guard');
  expect(triggers.filter((trigger) => trigger.condition?.isStartTrigger)).toHaveLength(1);
  expect(triggers.some((trigger) => trigger.type === 'manual_action')).toBeTruthy();
  expect(triggers.some((trigger) => trigger.type === 'scheduled')).toBeTruthy();
  expect(builder.manualActions?.some((action) => action.triggerId === 'manual-start-route')).toBeTruthy();
  expect(triggers.some((trigger) => trigger.id === 'decision-reroute')).toBeTruthy();
});

test('official Cargo route plan returns alternatives and a two-hour projection', () => {
  const plan = buildCargoRoutePlan({
    startPortId: 'shanghai',
    destinationPortId: 'rotterdam',
    speedKnots: 18,
    includeAlternatives: true,
  });
  expect(plan.alternatives?.length ?? 0).toBeGreaterThan(0);
  const progress = projectCargoProgress(plan, { hoursAhead: 2 });
  expect(progress.projectedPosition.latitude).toEqual(expect.any(Number));
  expect(progress.projectedPosition.longitude).toEqual(expect.any(Number));
  expect(progress.nextStop.id).toBeTruthy();
});

test('frontend live resolver resolves Cargo sources locally with app-origin metadata', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/routes')) {
      return Response.json({ graph: { ports: [] }, source: 'test' });
    }
    if (url.includes('/route-plan')) {
      return Response.json({ routePlan: { routeId: 'shanghai-rotterdam', alternatives: [] }, source: 'test' });
    }
    if (url.includes('/progress')) {
      return Response.json({
        progress: {
          projectedPosition: { latitude: 1.29, longitude: 103.85 },
          nextStop: { id: 'singapore' },
        },
        source: 'test',
      });
    }
    if (url.includes('/weather-sample')) {
      return Response.json({ weather: { temperature: 27, windSpeed: 8 }, source: 'test' });
    }
    return Response.json({ error: 'unexpected URL' }, { status: 404 });
  }) as typeof fetch;

  try {
    const expectedProgress = projectCargoProgress(buildCargoRoutePlan({
      startPortId: 'shanghai',
      destinationPortId: 'rotterdam',
      speedKnots: 18,
      includeAlternatives: true,
    }), { hoursAhead: 2 });
    const resolved = await resolveBuilderForManifestCore({
      builder,
      inputs: { startPortId: 'shanghai', destinationPortId: 'rotterdam', speedKnots: 18 },
      fetchDataSources: true,
      baseUrl: 'http://apps.lvh.me:3000',
    });
    expect(calls).toEqual([]);
    expect(resolved.snapshot.dataSources.routeProgress).toMatchObject({
      url: 'http://apps.lvh.me:3000/api/demo/cargo-climate/progress?startPortId=shanghai&destinationPortId=rotterdam&speedKnots=18&hours=2',
      body: { progress: { projectedPosition: expectedProgress.projectedPosition } },
    });
    const weatherStep = resolved.builder.agentChain.find((step) => step.id.startsWith('weather-sampler__'));
    expect(weatherStep?.urlTemplate).toContain(`latitude=${expectedProgress.projectedPosition.latitude}`);
    expect(weatherStep?.urlTemplate).toContain(`longitude=${expectedProgress.projectedPosition.longitude}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend live resolver applies Cargo defaults when world slug is customized', async () => {
  const customSlugBuilder: WorldBuilderConfig = {
    ...builder,
    uiSlug: 'atlantic-cargo-guard',
    config: {
      ...(builder.config ?? {}),
      sourceTemplateSlug: 'cargo-climate-guard',
    },
  };
  const expectedProgress = projectCargoProgress(buildCargoRoutePlan({
    startPortId: 'shanghai',
    destinationPortId: 'rotterdam',
    speedKnots: 18,
    includeAlternatives: true,
  }), { hoursAhead: 2 });

  const resolved = await resolveBuilderForManifestCore({
    builder: customSlugBuilder,
    inputs: { startPortId: 'shanghai', destinationPortId: 'rotterdam', speedKnots: 18 },
    fetchDataSources: true,
    baseUrl: 'http://atlantic-cargo-guard.app.lvh.me:3000',
  });

  expect(resolved.snapshot.dataSources.routeProgress).toMatchObject({
    body: { progress: { projectedPosition: expectedProgress.projectedPosition } },
  });
  const weatherStep = resolved.builder.agentChain.find((step) => step.id.startsWith('weather-sampler__'));
  expect(weatherStep?.urlTemplate).toContain(`latitude=${expectedProgress.projectedPosition.latitude}`);
  expect(weatherStep?.urlTemplate).toContain(`longitude=${expectedProgress.projectedPosition.longitude}`);
});

test('frontend live resolver rejects empty coordinate query values before fetching', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return Response.json({ ok: true });
  }) as typeof fetch;

  try {
    const resolved = await resolveBuilderForManifestCore({
      builder: {
        ...builder,
        uiSlug: 'custom-empty-query-test',
        config: {},
        dataSources: [
          { id: 'badWeather', name: 'Bad Weather', type: 'weather', url: '/api/weather?latitude=&longitude=', method: 'GET' },
        ],
        agentChain: [],
        triggers: [],
      },
      fetchDataSources: true,
      baseUrl: 'http://apps.lvh.me:3000',
    });
    expect(calls).toHaveLength(0);
    expect(resolved.snapshot.dataSources.badWeather).toMatchObject({
      ok: false,
      error: 'URL query value(s) are empty: latitude, longitude.',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('official Cargo manifest validates resolved sources and decision continuations', () => {
  const manifest = compileWorldManifest(resolvedCargoBuilder());
  expect(manifest.unsupported).toEqual([]);
  expect(manifest.decisionContinuations.length).toBeGreaterThan(0);
});

test('official Cargo manifest rejects invalid live weather URL and missing continuation', () => {
  const invalidWeather = resolvedCargoBuilder({
    agentChain: builder.agentChain.map((step) => step.id === 'weather-sampler'
      ? { ...step, urlTemplate: 'Fetch weather in natural language.' }
      : step),
  });
  expect(compileWorldManifest(invalidWeather).unsupported.join('\n')).toContain('Weather JSON Agent');

  const missingContinuation = resolvedCargoBuilder({
    triggers: builder.triggers?.map((trigger) => trigger.id === 'manual-start-route'
      ? {
          ...trigger,
          decisionContinuations: [],
          typeConfig: { ...trigger.typeConfig, decisionContinuations: [] },
          condition: { ...trigger.condition, decisionContinuations: [] },
        }
      : trigger),
  });
  expect(compileWorldManifest(missingContinuation).unsupported.join('\n')).toContain('Manual start route');
});

test('official Cargo start trigger executes through generic trigger flow', async () => {
  const trigger = builder.triggers?.find((item) => item.condition?.isStartTrigger);
  expect(trigger).toBeTruthy();
  const run = await executeTriggerFlow({
    worldId: 'cargo-test-world',
    builder,
    trigger: trigger!,
    actionId: 'manual-start-route',
    inputs: {
      startPortId: 'shanghai',
      destinationPortId: 'rotterdam',
      speedKnots: 18,
    },
    worldState: {},
    payload: { startedAt: '2026-06-08T00:00:00.000Z' },
  });
  expect(run.engine).toBe('genericEventWorld');
  expect(run.status).toBe('complete');
  expect(run.summary.triggerId).toBe('manual-start-route');
  expect(run.agentResponses.map((agent) => agent.id)).toEqual([
    'route-planner',
    'position-projector',
    'weather-sampler',
    'weather-risk',
    'route-decision',
    'chronicle-state',
  ]);
  expect(run.receipts).toHaveLength(6);
  expect(run.worldState.factions).toBeTruthy();
});

test('official Cargo manual trigger executes through generic trigger flow', async () => {
  const trigger = builder.triggers?.find((item) => item.id === 'manual-start-route');
  expect(trigger).toBeTruthy();
  const run = await executeTriggerFlow({
    worldId: 'cargo-test-world',
    builder,
    trigger: trigger!,
    actionId: 'start-voyage',
    inputs: {
      startPortId: 'singapore',
      destinationPortId: 'rotterdam',
      speedKnots: 16,
    },
    worldState: {},
    payload: { requestedBy: 'owner' },
  });
  expect(run.engine).toBe('genericEventWorld');
  expect(run.status).toBe('complete');
  expect(run.summary.triggerId).toBe('manual-start-route');
  expect(run.agentResponses.length).toBeGreaterThan(0);
});
