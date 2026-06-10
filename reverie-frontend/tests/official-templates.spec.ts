import { expect, test } from '@playwright/test';
import { buildOfficialWorldConfig, officialBuilderTemplates } from '../lib/shared/official-template-builders';
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
      const startRun = await executeTriggerFlow({
        worldId: `${slug}-test-world`,
        builder,
        trigger: startTrigger!,
        actionId: `start-${slug}`,
        inputs,
        worldState: {},
        payload: { startedAt: '2026-06-08T00:00:00.000Z' },
      });
      expect(startRun.engine).toBe('genericEventWorld');
      expect(startRun.status).toBe('complete');
      expect(startRun.agentResponses.length).toBeGreaterThan(0);
      expect(startRun.receipts.length).toBe(startRun.agentResponses.length);

      const manualAction = builder.manualActions?.find((action) => action.triggerId);
      expect(manualAction).toBeTruthy();
      const manualTrigger = builder.triggers?.find((trigger) => trigger.id === manualAction!.triggerId);
      expect(manualTrigger).toBeTruthy();
      const manualRun = await executeTriggerFlow({
        worldId: `${slug}-test-world`,
        builder,
        trigger: manualTrigger!,
        actionId: manualAction!.id,
        inputs,
        worldState: startRun.worldState,
        payload: manualAction!.inputOverrides ?? { requestedBy: 'owner' },
      });
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

test('official template registry includes Cargo plus ideas 1-4', () => {
  expect(officialBuilderTemplates.map((template) => template.slug)).toEqual([
    'cargo-climate-guard',
    'global-climate-crisis-response',
    'crypto-market-intelligence',
    'sports-prediction-league',
    'living-kingdom-lite',
  ]);
});
