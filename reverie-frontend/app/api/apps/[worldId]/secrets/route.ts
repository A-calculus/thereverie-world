import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { canEncryptSecrets, encryptSecret } from '@/lib/server/secrets';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';

interface Params {
  params: Promise<{ worldId: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;

  if (!hasSupabaseAdminEnv()) return NextResponse.json({ secrets: [], source: 'demo' });
  const supabase = createAdminSupabaseClient();
  const { data } = await supabase.from('world_secrets').select('secret_key,updated_at').eq('world_id', worldId);
  return NextResponse.json({ secrets: (data ?? []).map((item) => ({ key: item.secret_key, updatedAt: item.updated_at })) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;
  const body = await req.json();
  const key = String(body.key ?? '').trim();
  const value = String(body.value ?? '');
  if (!key || !value) return NextResponse.json({ error: 'Secret key and value are required' }, { status: 400 });

  if (!hasSupabaseAdminEnv() || !canEncryptSecrets()) {
    return NextResponse.json({
      error: 'Durable Supabase and REVERIE_SECRETS_KEY are required to store secrets.',
      secrets: [],
    }, { status: 501 });
  }

  const ownerId = await ensureSupabaseUser(session);
  if (!ownerId) return NextResponse.json({ error: 'Unable to resolve user' }, { status: 500 });
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from('world_secrets').upsert({
    world_id: worldId,
    owner_id: ownerId,
    secret_key: key,
    secret_value: encryptSecret(value),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'world_id,secret_key' });

  if (error) return NextResponse.json({ error: 'Failed to save secret' }, { status: 500 });
  return NextResponse.json({ secret: { key } }, { status: 201 });
}
