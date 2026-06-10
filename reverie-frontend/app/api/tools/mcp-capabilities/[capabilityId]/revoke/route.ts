import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ capabilityId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required to revoke MCP capabilities.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const { capabilityId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to resolve owner profile.' }, { status: 401 });
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    revoked_at: now,
    revoked_reason: typeof body.reason === 'string' ? body.reason : 'manual_revoke',
    updated_at: now,
  };
  if (typeof body.requestId === 'string') update.request_id = body.requestId;
  const { error } = await supabase
    .from('tool_mcp_capabilities')
    .update(update)
    .eq('id', capabilityId)
    .eq('owner_id', userId)
    .is('revoked_at', null);
  if (error) return NextResponse.json({ error: 'Failed to revoke MCP capability.' }, { status: 500 });
  return NextResponse.json({ revokedAt: now });
}
