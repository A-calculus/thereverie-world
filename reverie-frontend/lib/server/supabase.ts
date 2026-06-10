import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase-server';
import type { ReverieSession } from './session';

export function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function hasSupabaseAdminEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function getSupabaseUserId(session: ReverieSession): Promise<string | null> {
  if (!hasSupabaseAdminEnv() && !hasSupabaseEnv()) return null;

  const supabase = hasSupabaseAdminEnv() ? createAdminSupabaseClient() : await createServerSupabaseClient();
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('wallet_address', session.walletAddress)
    .single();

  return user?.id ?? null;
}

export async function ensureSupabaseUser(session: ReverieSession): Promise<string | null> {
  if (!hasSupabaseAdminEnv()) return null;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        wallet_address: session.walletAddress,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (error) {
    console.error('Unable to ensure Supabase user:', error);
    return null;
  }

  return data?.id ?? null;
}

export async function resolveTemplateId(templateSlug: string | null | undefined): Promise<string | null> {
  if (!templateSlug || (!hasSupabaseAdminEnv() && !hasSupabaseEnv())) return null;

  const supabase = hasSupabaseAdminEnv() ? createAdminSupabaseClient() : await createServerSupabaseClient();
  const { data: bySlug } = await supabase
    .from('templates')
    .select('id,name')
    .eq('slug', templateSlug)
    .limit(1)
    .maybeSingle();

  if (bySlug?.id) return bySlug.id;

  const { data } = await supabase
    .from('templates')
    .select('id,name')
    .ilike('name', templateSlug.replace(/-/g, ' '))
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

export { createSupabaseClient };
