import type { WorldBuilderConfig } from '@/lib/shared/types';

export const CARGO_TEMPLATE_SLUG = 'cargo-climate-guard';
export const CARGO_TEMPLATE_VERSION = 'cargo-autonomous-template-v2';

export function isCargoBuilder(builder: WorldBuilderConfig | null | undefined) {
  return Boolean(builder && (
    builder.uiSlug === CARGO_TEMPLATE_SLUG ||
    builder.config?.sourceTemplateSlug === CARGO_TEMPLATE_SLUG ||
    builder.config?.worldSlug === CARGO_TEMPLATE_SLUG ||
    builder.config?.officialTemplate === CARGO_TEMPLATE_VERSION
  ));
}

export function builderTemplateSlug(builder: WorldBuilderConfig | null | undefined) {
  if (isCargoBuilder(builder)) return CARGO_TEMPLATE_SLUG;
  const sourceTemplateSlug = builder?.config?.sourceTemplateSlug;
  return typeof sourceTemplateSlug === 'string' && sourceTemplateSlug.trim()
    ? sourceTemplateSlug
    : builder?.uiSlug || 'custom';
}
