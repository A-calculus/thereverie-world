import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for reconciliation.' }, { status: 503 });

  const supabase = createAdminSupabaseClient();
  const now = new Date().toISOString();
  const { data: worlds, error } = await supabase
    .from('worlds')
    .select('id,contract_address,status')
    .not('contract_address', 'is', null)
    .in('status', ['deployed', 'running', 'stopped']);
  if (error) return NextResponse.json({ error: 'Failed to load live worlds.' }, { status: 500 });

  await supabase.from('world_reconciliation_checkpoints').insert({
    checkpoint_key: 'vercel-cron',
    world_count: worlds?.length ?? 0,
    last_checked_at: now,
    details: { note: 'Reconciliation checkpoint recorded. Bounded log backfill is configured in the SDK/runtime roadmap.' },
  });

  return NextResponse.json({ ok: true, worldCount: worlds?.length ?? 0, checkedAt: now });
}
