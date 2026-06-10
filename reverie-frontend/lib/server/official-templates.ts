import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { buildOfficialWorldConfig, officialBuilderTemplates } from '@/lib/shared/official-template-builders';
import type { TemplateSummary } from '@/lib/shared/types';

type TemplateCategory = TemplateSummary['category'];

export type OfficialTemplateRecord = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  category: TemplateCategory;
  world_config: Record<string, unknown>;
  creator_id: null;
  is_public: true;
  featured: true;
  download_count?: number;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const officialTemplates: OfficialTemplateRecord[] = officialBuilderTemplates.map((template) => ({
  slug: template.slug,
  name: template.name,
  description: template.description,
  category: template.category,
  world_config: buildOfficialWorldConfig(template),
  creator_id: null,
  is_public: true,
  featured: true,
}));

export const officialTemplateSlugs = new Set(officialTemplates.map((template) => template.slug));

export function getOfficialTemplateBySlug(slug: string | null | undefined) {
  if (!slug) return null;
  return officialTemplates.find((template) => template.slug === slug) ?? null;
}

export function isOfficialCargoTemplateState(state: Record<string, unknown>) {
  const builder = objectValue(state.builder);
  const config = objectValue(builder.config);
  return state.templateSlug === 'cargo-climate-guard'
    || config.sourceTemplateSlug === 'cargo-climate-guard'
    || builder.uiSlug === 'cargo-climate-guard';
}

export function mergeOfficialTemplateConfig<T extends { slug?: string; world_config?: unknown }>(record: T): T {
  const official = getOfficialTemplateBySlug(record.slug);
  if (!official) return record;
  const config = objectValue(record.world_config);
  const worldState = objectValue(config.worldState);
  const builder = objectValue(worldState.builder ?? config.builder);
  if (Object.keys(builder).length > 0) return record;
  return {
    ...record,
    world_config: official.world_config,
  };
}

function shouldHydrateOfficialTemplate(existing: unknown) {
  const record = objectValue(existing);
  if (Object.keys(record).length === 0) return true;
  if (record.creator_id !== null) return true;
  if (record.is_public !== true || record.featured !== true) return true;
  const config = objectValue(record.world_config);
  const worldState = objectValue(config.worldState);
  const builder = objectValue(worldState.builder ?? config.builder);
  return Object.keys(builder).length === 0;
}

export async function ensureOfficialTemplatesSeeded() {
  if (!hasSupabaseAdminEnv()) return [];
  const supabase = createAdminSupabaseClient();
  const slugs = officialTemplates.map((template) => template.slug);
  const { data: existingRows } = await supabase
    .from('templates')
    .select('id,slug,creator_id,is_public,featured,world_config')
    .in('slug', slugs);
  const existingBySlug = new Map((existingRows ?? []).map((row) => [String(row.slug), row]));
  const rowsToUpsert = officialTemplates.filter((template) => shouldHydrateOfficialTemplate(existingBySlug.get(template.slug)));
  if (rowsToUpsert.length === 0) return [];
  const { data, error } = await supabase
    .from('templates')
    .upsert(rowsToUpsert.map((template) => ({
      creator_id: null,
      slug: template.slug,
      name: template.name,
      description: template.description,
      category: template.category,
      world_config: template.world_config,
      is_public: true,
      featured: true,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'slug', ignoreDuplicates: false })
    .select();
  if (error) {
    console.error('Unable to hydrate official templates:', error);
    return [];
  }
  return data ?? [];
}
