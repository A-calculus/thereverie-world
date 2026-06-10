import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { isUuid } from '@/lib/server/tools/db';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ toolId: string; key: string }>;
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { toolId, key } = await params;
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ ok: true, source: 'demo' });
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  let query = supabase.from('tools').select('id').eq('owner_id', userId);
  query = isUuid(toolId) ? query.eq('id', toolId) : query.eq('slug', toolId);
  const { data: tool } = await query.maybeSingle();
  if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  const { error } = await supabase.from('tool_secrets').delete().eq('tool_id', tool.id).eq('owner_id', userId).eq('secret_key', decodeURIComponent(key));
  if (error) return NextResponse.json({ error: 'Failed to delete tool secret' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
