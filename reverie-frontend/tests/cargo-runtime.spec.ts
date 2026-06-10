import { expect, test } from '@playwright/test';
import { compileWorldManifest } from '@worldframe/sdk/browser';
import officialTemplate from '../content/official-templates/cargo-climate-guard.v1.json';
import type { WorldBuilderConfig } from '../lib/shared/types';
import { buildCargoRoutePlan, projectCargoProgress } from '../lib/shared/cargo-climate/engine';
import { executeTriggerFlow } from '../lib/shared/world-runtime/trigger-flow';

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
