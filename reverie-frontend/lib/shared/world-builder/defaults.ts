import { getOfficialBuilderTemplate } from '@/lib/shared/official-template-builders';
import { createBlankWorldBuilderConfig, createRuntimeFoundationConfig, normalizeWithRuntimeFoundation } from '@/lib/shared/world-builder/runtime-foundation';
import type { WorldBuilderConfig } from '@/lib/shared/types';

export function createGenericBuilderConfig(params: {
  name: string;
  slug?: string;
  description?: string;
}): WorldBuilderConfig {
  return createRuntimeFoundationConfig(params);
}

export function normalizeBuilderConfig(builder: WorldBuilderConfig): WorldBuilderConfig {
  return normalizeWithRuntimeFoundation(builder);
}

export function getTemplateBuilderConfig(templateSlug: string, worldName: string): WorldBuilderConfig {
  const officialTemplate = getOfficialBuilderTemplate(templateSlug);
  if (officialTemplate) {
    return normalizeBuilderConfig({
      ...officialTemplate.builder,
      displayName: `${worldName} ${officialTemplate.name}`,
      config: {
        ...(officialTemplate.builder.config ?? {}),
        worldSlug: officialTemplate.slug,
        sourceTemplateSlug: officialTemplate.slug,
      },
    });
  }

  if (templateSlug === 'blank' || templateSlug === 'void') {
    return createBlankWorldBuilderConfig({ name: worldName });
  }

  return createGenericBuilderConfig({ name: worldName, slug: templateSlug });
}
