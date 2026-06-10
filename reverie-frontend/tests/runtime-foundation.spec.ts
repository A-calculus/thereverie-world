import { expect, test } from '@playwright/test';
import { getTemplateBuilderConfig, normalizeBuilderConfig } from '../lib/shared/world-builder/defaults';
import {
  buildFoundationGraph,
  createBlankWorldBuilderConfig,
  createRuntimeFoundationConfig,
  normalizeWithRuntimeFoundation,
} from '../lib/shared/world-builder/runtime-foundation';
import { officialBuilderTemplates } from '../lib/shared/official-template-builders';
import type { WorldBuilderConfig } from '../lib/shared/types';

test('blank runtime foundation has editable starter scaffold without marketplace identity', () => {
  const builder = createBlankWorldBuilderConfig({ name: 'My Blank World' });
  expect(builder.engine).toBe('genericEventWorld');
  expect(builder.config?.runtimeFoundation).toBe('runtime-foundation-v1');
  expect(builder.config?.starterScaffold).toBe(true);
  expect(builder.config?.sourceTemplateSlug).toBeUndefined();
  expect(builder.config?.officialTemplate).toBeUndefined();
  expect(builder.inputSchema).toHaveLength(1);
  expect(builder.inputSchema[0].id).toBe('runtimeInput');
  expect(builder.zones).toHaveLength(1);
  expect(builder.factions).toHaveLength(1);
  expect(builder.triggers).toHaveLength(1);
  expect(builder.triggers?.[0].type).toBe('manual_action');
  expect(builder.triggers?.[0].isActive).toBe(false);
  expect(builder.manualActions).toHaveLength(1);
  expect(builder.runtimeLayout.some((section) => section.kind === 'manual_actions')).toBeTruthy();
});

test('generic foundation can be empty when used as a neutral base', () => {
  const builder = createRuntimeFoundationConfig({ name: 'Foundation Only' });
  expect(builder.config?.starterScaffold).toBe(false);
  expect(builder.inputSchema).toEqual([]);
  expect(builder.zones).toEqual([]);
  expect(builder.factions).toEqual([]);
  expect(builder.triggers).toEqual([]);
  expect(builder.manualActions).toEqual([]);
  expect(builder.runtimeLayout.length).toBeGreaterThan(0);
});

test('blank template config uses starter scaffold, while unknown templates use neutral foundation', () => {
  const blank = getTemplateBuilderConfig('blank', 'Blank Build');
  expect(blank.config?.starterScaffold).toBe(true);
  expect(blank.triggers?.[0].id).toBe('manual-runtime-action');

  const unknown = getTemplateBuilderConfig('custom-experiment', 'Custom Build');
  expect(unknown.config?.starterScaffold).toBe(false);
  expect(unknown.uiSlug).toBe('custom-experiment');
  expect(unknown.triggers).toEqual([]);
});

test('normalization does not re-add starter objects after user removes them', () => {
  const blank = createBlankWorldBuilderConfig({ name: 'Editable Blank' });
  const edited: WorldBuilderConfig = {
    ...blank,
    inputSchema: [],
    zones: [],
    factions: [],
    triggers: [],
    manualActions: [],
    graph: { nodes: [], edges: [] },
  };
  const normalized = normalizeBuilderConfig(edited);
  expect(normalized.inputSchema).toEqual([]);
  expect(normalized.zones).toEqual([]);
  expect(normalized.factions).toEqual([]);
  expect(normalized.triggers).toEqual([]);
  expect(normalized.manualActions).toEqual([]);
  expect(normalized.runtimeLayout.length).toBeGreaterThan(0);
});

test('official templates normalize through the same foundation', () => {
  for (const template of officialBuilderTemplates) {
    const normalized = normalizeWithRuntimeFoundation(template.builder);
    expect(normalized.engine).toBe('genericEventWorld');
    expect(normalized.config?.runtimeFoundation).toBe('runtime-foundation-v1');
    expect(normalized.runtimeLayout.length).toBeGreaterThan(0);
    expect(normalized.graph?.nodes.length ?? 0).toBeGreaterThan(0);
    expect(normalized.config?.sourceTemplateSlug).toBe(template.slug);
  }
});

test('foundation graph creates nodes for all generic world pieces', () => {
  const builder = createBlankWorldBuilderConfig({ name: 'Graph World' });
  const graph = buildFoundationGraph(builder);
  expect(graph.nodes.some((node) => node.type === 'input')).toBeTruthy();
  expect(graph.nodes.some((node) => node.type === 'trigger')).toBeTruthy();
  expect(graph.nodes.some((node) => node.type === 'zone')).toBeTruthy();
  expect(graph.nodes.some((node) => node.type === 'faction')).toBeTruthy();
  expect(graph.nodes.some((node) => node.type === 'manualAction')).toBeTruthy();
});
