import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { createBearerToken, hashToken } from '@/lib/server/tools/db';
import { mcpCapabilityUrl } from '@/lib/shared/tools';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required to create MCP capabilities.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const toolIds = Array.isArray(body.toolIds) ? body.toolIds.filter((item: unknown): item is string => typeof item === 'string') : [];
  if (toolIds.length === 0) return NextResponse.json({ error: 'Select at least one deployed tool.' }, { status: 400 });
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  const { data: tools, error: toolsError } = await supabase
    .from('tools')
    .select('id')
    .eq('owner_id', userId)
    .eq('status', 'deployed')
    .in('id', toolIds);
  if (toolsError) return NextResponse.json({ error: 'Failed to verify selected tools.' }, { status: 500 });
  const verifiedToolIds = (tools ?? []).map((tool) => tool.id);
  if (verifiedToolIds.length !== toolIds.length) return NextResponse.json({ error: 'Every selected tool must be deployed and owned by you.' }, { status: 400 });
  const token = createBearerToken();
  const { data, error } = await supabase
    .from('tool_mcp_capabilities')
    .insert({
      owner_id: userId,
      agent_id: typeof body.agentId === 'string' && /^[0-9a-f-]{36}$/i.test(body.agentId) ? body.agentId : null,
      world_id: typeof body.worldId === 'string' && /^[0-9a-f-]{36}$/i.test(body.worldId) ? body.worldId : null,
      trigger_id: typeof body.triggerId === 'string' ? body.triggerId : null,
      request_id: typeof body.requestId === 'string' ? body.requestId : null,
      token_hash: hashToken(token),
      tool_ids: verifiedToolIds,
      name: typeof body.name === 'string' ? body.name : 'REVERIE Tools MCP',
      expires_at: typeof body.expiresAt === 'string' ? body.expiresAt : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to create MCP capability.' }, { status: 500 });
  return NextResponse.json({ capabilityId: data.id, token, mcpServerUrl: mcpCapabilityUrl(data.id, token), toolIds: verifiedToolIds });
}
