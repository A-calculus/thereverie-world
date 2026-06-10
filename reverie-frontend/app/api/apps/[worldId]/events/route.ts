import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { demoEvents } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { formatDbWorldEvent } from '@/lib/server/world-event-log';
import { buildRuntimeTimeline } from '@/lib/server/runtime-timeline';

interface Params {
  params: Promise<{ worldId: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  const { worldId } = await params;
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 50)));

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      events: demoEvents.filter((event) => event.worldId === worldId).slice(0, limit),
      source: 'demo',
    });
  }

  const supabase = createAdminSupabaseClient();
  const userId = session ? await ensureSupabaseUser(session) : null;
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId, publicOnly: !userId });
  if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('events')
    .select('id,world_id,event_type,request_id,transaction_hash,result,cost_sttt,created_at')
    .eq('world_id', world.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: 'Unable to load world events.' }, { status: 500 });
  const { timeline, aggregates } = await buildRuntimeTimeline({ supabase, world, limit });
  return NextResponse.json({
    events: (data ?? []).map((event) => formatDbWorldEvent(event)),
    timeline,
    aggregates,
    source: 'supabase',
  });
}
