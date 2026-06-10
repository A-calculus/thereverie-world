import { expect, test } from '@playwright/test';
import { compileWorldManifest } from '@worldframe/sdk/browser';
import { buildOfficialWorldConfig, officialBuilderTemplates } from '../lib/shared/official-template-builders';
import { resolveBuilderForManifestCore } from '../lib/shared/live-builder-resolution-core';
import { executeTriggerFlow } from '../lib/shared/world-runtime/trigger-flow';
import type { WorldBuilderConfig } from '../lib/shared/types';

const ideaTemplateSlugs = [
  'global-climate-crisis-response',
  'crypto-market-intelligence',
  'sports-prediction-league',
  'living-kingdom-lite',
];

function defaultInputs(builder: WorldBuilderConfig) {
  return Object.fromEntries((builder.inputSchema ?? []).map((input) => [input.id, input.defaultValue ?? 'demo']));
}

function serialized(value: unknown) {
  return JSON.stringify(value);
}

async function withMockedDataSourceFetch<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('open-meteo.com')) {
      return Response.json({
        current: {
          time: '2026-06-10T12:00',
          temperature_2m: 14.8,
          wind_speed_10m: 22.4,
          precipitation: 3.1,
          weather_code: 61,
        },
      });
    }
    if (url.includes('binance.com')) {
      return Response.json({
        symbol: 'ETHUSDT',
        lastPrice: '3500.00',
        priceChangePercent: '-2.5',
        volume: '120000',
      });
    }
    if (url.includes('/api/demo/sports-prediction/matches')) {
      return Response.json({
        match: {
          id: 'match-001',
          status: 'final',
          homeTeam: 'Lions',
          awayTeam: 'Falcons',
          finalScore: '2-1',
        },
      });
    }
    return Response.json({ ok: true, current: { weather_code: 1 } });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test.describe('official idea templates', () => {
  for (const slug of ideaTemplateSlugs) {
    const template = officialBuilderTemplates.find((item) => item.slug === slug);
    if (!template) throw new Error(`Missing official template ${slug}`);
    const builder = template.builder;

    test(`${slug} is a generic runnable official template`, () => {
      expect(builder.engine).toBe('genericEventWorld');
      expect(builder.config?.sourceTemplateSlug).toBe(slug);
      expect(builder.inputSchema.length).toBeGreaterThan(0);
      expect(builder.dataSources.length).toBeGreaterThan(0);
      expect(builder.agentChain.length).toBeGreaterThan(0);
      expect(builder.zones?.length ?? 0).toBeGreaterThan(0);
      expect(builder.factions?.length ?? 0).toBeGreaterThan(0);
      expect((builder.triggers ?? []).filter((trigger) => trigger.condition?.isStartTrigger)).toHaveLength(1);
      expect(builder.manualActions?.some((action) => action.ownerOnly && action.triggerId)).toBeTruthy();
      expect(serialized(builder)).not.toContain('token=');
      expect(serialized(builder)).not.toContain('endpointToken');
      expect(serialized(builder)).not.toContain('secret_value');
    });

    test(`${slug} executes start and manual trigger through generic trigger flow`, async () => {
      const inputs = defaultInputs(builder);
      const startTrigger = builder.triggers?.find((trigger) => trigger.condition?.isStartTrigger);
      expect(startTrigger).toBeTruthy();
      const startRun = await withMockedDataSourceFetch(() => executeTriggerFlow({
        worldId: `${slug}-test-world`,
        builder,
        trigger: startTrigger!,
        actionId: `start-${slug}`,
        inputs,
        worldState: {},
        payload: { startedAt: '2026-06-08T00:00:00.000Z' },
      }));
      expect(startRun.engine).toBe('genericEventWorld');
      expect(startRun.status).toBe('complete');
      expect(startRun.agentResponses.length).toBeGreaterThan(0);
      expect(startRun.receipts.length).toBe(startRun.agentResponses.length);

      const manualAction = builder.manualActions?.find((action) => action.triggerId);
      expect(manualAction).toBeTruthy();
      const manualTrigger = builder.triggers?.find((trigger) => trigger.id === manualAction!.triggerId);
      expect(manualTrigger).toBeTruthy();
      const manualRun = await withMockedDataSourceFetch(() => executeTriggerFlow({
        worldId: `${slug}-test-world`,
        builder,
        trigger: manualTrigger!,
        actionId: manualAction!.id,
        inputs,
        worldState: startRun.worldState,
        payload: manualAction!.inputOverrides ?? { requestedBy: 'owner' },
      }));
      expect(manualRun.engine).toBe('genericEventWorld');
      expect(manualRun.status).toBe('complete');
      expect(manualRun.agentResponses.length).toBeGreaterThan(0);
    });

    test(`${slug} builds a full official world config snapshot`, () => {
      const config = buildOfficialWorldConfig(template);
      expect(config.officialTemplate).toBe(template.officialTemplate);
      expect(config.worldState.templateSlug).toBe(slug);
      expect(config.worldState.builder).toBe(builder);
      expect(config.worldState.agents).toEqual([]);
      expect(config.worldState.zones.length).toBeGreaterThan(0);
      expect(config.worldState.factions.length).toBeGreaterThan(0);
    });
  }
});

test.describe('global climate crisis response template', () => {
  const template = officialBuilderTemplates.find((item) => item.slug === 'global-climate-crisis-response');
  if (!template) throw new Error('Missing Global Climate Crisis Response template');
  const builder = template.builder;

  test('uses one scheduled start trigger and fixed weather URLs', () => {
    const startTriggers = (builder.triggers ?? []).filter((trigger) => trigger.condition?.isStartTrigger);
    expect(startTriggers).toHaveLength(1);
    expect(startTriggers[0].id).toBe('scheduled-weather-check');
    expect(startTriggers[0].type).toBe('scheduled');

    const weatherSteps = builder.agentChain.filter((step) => step.agentType === 'native_json_api');
    expect(weatherSteps.map((step) => step.id)).toEqual([
      'weather-reader-americas',
      'weather-reader-europe',
      'weather-reader-asia-pacific',
      'weather-reader-africa-middle-east',
    ]);
    for (const step of weatherSteps) {
      expect(step.urlTemplate).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
      expect(step.urlTemplate).toContain('latitude=');
      expect(step.urlTemplate).toContain('longitude=');
      expect(step.urlTemplate).not.toContain('{{');
    }
  });

  test('materialized latest template agents preserve source template identity', () => {
    const materializedBuilder: WorldBuilderConfig = {
      ...builder,
      uiSlug: 'storm-response-demo',
      config: {
        ...(builder.config ?? {}),
        worldSlug: 'storm-response-demo',
        sourceTemplateSlug: 'global-climate-crisis-response',
      },
      agentChain: builder.agentChain.map((step, index) => ({
        ...step,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        agentId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        name: `${step.name} (Global Climate Crisis Response Template - Demo 12345678)`,
        sourceTemplateAgentId: step.id,
      }) as WorldBuilderConfig['agentChain'][number]),
    };

    expect(materializedBuilder.config?.sourceTemplateSlug).toBe('global-climate-crisis-response');
    expect(materializedBuilder.agentChain.every((step) => (
      typeof (step as typeof step & { sourceTemplateAgentId?: unknown }).sourceTemplateAgentId === 'string'
    ))).toBe(true);
  });

  test('resolves and compiles into a live manifest without unsupported items', async () => {
    const resolved = await withMockedDataSourceFetch(() => resolveBuilderForManifestCore({
      builder,
      inputs: defaultInputs(builder),
      fetchDataSources: true,
      baseUrl: 'http://lvh.me:3000',
    }));
    expect(Object.keys(resolved.snapshot.dataSources)).toEqual([
      'weatherAmericas',
      'weatherEurope',
      'weatherAsiaPacific',
      'weatherAfricaMiddleEast',
    ]);
    for (const step of resolved.builder.agentChain) {
      expect(step.inputTemplate).not.toContain('{{');
      expect(step.contextTemplate ?? '').not.toContain('{{');
      expect(step.urlTemplate ?? '').not.toContain('{{');
    }
    const manifest = compileWorldManifest(resolved.builder);
    expect(manifest.unsupported).toEqual([]);
    expect(manifest.triggers).toHaveLength(5);
    expect(manifest.decisionContinuations).toHaveLength(4);
    expect(manifest.triggers.some((trigger) => trigger.schedule?.cronExpression === '*/30 * * * *')).toBeTruthy();
    expect(serialized(resolved.builder)).not.toContain('Cargo route plan');
    expect(serialized(resolved.builder)).not.toContain('latitude=6.5&longitude=3.4');
  });

  test('fallback start trigger creates visible crisis state movement', async () => {
    const startTrigger = (builder.triggers ?? []).find((trigger) => trigger.id === 'scheduled-weather-check');
    expect(startTrigger).toBeTruthy();
    const run = await withMockedDataSourceFetch(() => executeTriggerFlow({
      worldId: 'global-climate-test-world',
      builder,
      trigger: startTrigger!,
      actionId: 'start-global-climate',
      inputs: defaultInputs(builder),
      worldState: {},
      payload: { startedAt: '2026-06-10T12:00:00.000Z' },
    }));
    expect(run.status).toBe('complete');
    expect(run.agentResponses).toHaveLength(8);
    expect(run.receipts).toHaveLength(8);
    expect(serialized(run.worldState)).toContain('AUTONOMOUS_SCAN_COMPLETE');
    expect(serialized(run.worldState)).toContain('Scheduled scan refreshed Europe crisis posture.');
    expect(serialized(run.worldState)).toContain('Government readiness refreshed by scheduled scan.');
    expect(run.events.some((event) => event.title === 'Crisis event log')).toBeTruthy();
  });
});

test('official template registry includes Cargo plus ideas 1-4', () => {
  expect(officialBuilderTemplates.map((template) => template.slug)).toEqual([
    'cargo-climate-guard',
    'global-climate-crisis-response',
    'crypto-market-intelligence',
    'sports-prediction-league',
    'living-kingdom-lite',
  ]);
});
