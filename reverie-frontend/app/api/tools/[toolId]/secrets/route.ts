import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { encryptSecret, isUuid, secretRefs } from '@/lib/server/tools/db';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ toolId: string }>;
}

async function findTool(supabase: ReturnType<typeof createAdminSupabaseClient>, userId: string, toolId: string) {
  let query = supabase.from('tools').select('id').eq('owner_id', userId);
  query = isUuid(toolId) ? query.eq('id', toolId) : query.eq('slug', toolId);
  return query.maybeSingle();
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ secrets: [], source: 'demo' });
  const { toolId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  const { data: tool } = await findTool(supabase, userId, toolId);
  if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  const { data, error } = await supabase.from('tool_secrets').select('secret_key,created_at').eq('tool_id', tool.id).eq('owner_id', userId).order('secret_key');
  if (error) return NextResponse.json({ error: 'Failed to load tool secrets' }, { status: 500 });
  return NextResponse.json({ secrets: secretRefs(data ?? []) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { toolId } = await params;
  const body = await req.json().catch(() => ({}));
  const key = String(body.key ?? body.secretKey ?? '').trim();
  const value = String(body.value ?? body.secretValue ?? '');
  if (!/^[A-Z0-9_][A-Z0-9_]*$/i.test(key)) return NextResponse.json({ error: 'Secret key must be alphanumeric or underscore.' }, { status: 400 });
  if (!value) return NextResponse.json({ error: 'Secret value is required.' }, { status: 400 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ secrets: [{ key }], source: 'demo' });
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  const { data: tool } = await findTool(supabase, userId, toolId);
  if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  const { error } = await supabase.from('tool_secrets').upsert({
    tool_id: tool.id,
    owner_id: userId,
    secret_key: key,
    secret_value: encryptSecret(value),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tool_id,secret_key', ignoreDuplicates: false });
  if (error) return NextResponse.json({ error: 'Failed to save tool secret' }, { status: 500 });
  const { data } = await supabase.from('tool_secrets').select('secret_key,created_at').eq('tool_id', tool.id).eq('owner_id', userId).order('secret_key');
  return NextResponse.json({ secrets: secretRefs(data ?? []) });
}
