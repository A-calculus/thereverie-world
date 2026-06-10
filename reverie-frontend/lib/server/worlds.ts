import type { SupabaseClient } from '@supabase/supabase-js';

export function slugifyWorldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function resolveWorldByIdOrSlug(
  supabase: SupabaseClient,
  worldIdOrSlug: string,
  options: { ownerId?: string | null; publicOnly?: boolean } = {}
) {
  if (isUuid(worldIdOrSlug)) {
    let query = supabase.from('worlds').select('*').eq('id', worldIdOrSlug);
    if (options.ownerId) query = query.eq('owner_id', options.ownerId);
    if (options.publicOnly) query = query.in('status', ['deployed', 'running', 'stopped']);
    const { data, error } = await query.maybeSingle();
    if (!error && data) return data;
  }

  let listQuery = supabase.from('worlds').select('*');
  if (options.ownerId) listQuery = listQuery.eq('owner_id', options.ownerId);
  if (options.publicOnly) listQuery = listQuery.in('status', ['deployed', 'running', 'stopped']);
  const { data } = await listQuery.order('created_at', { ascending: false });
  return (data ?? []).find((world) => (
    slugifyWorldName(world.name) === worldIdOrSlug ||
    world.contract_address?.toLowerCase() === worldIdOrSlug.toLowerCase()
  )) ?? null;
}
