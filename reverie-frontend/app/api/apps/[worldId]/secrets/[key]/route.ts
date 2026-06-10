import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';

interface Params {
  params: Promise<{ worldId: string; key: string }>;
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId, key } = await params;

  if (!hasSupabaseAdminEnv()) return NextResponse.json({ deleted: key, source: 'demo' });
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from('world_secrets').delete().eq('world_id', worldId).eq('secret_key', key);
  if (error) return NextResponse.json({ error: 'Failed to delete secret' }, { status: 500 });
  return NextResponse.json({ deleted: key });
}
