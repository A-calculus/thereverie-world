import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { decryptSecret, hashToken, isUuid } from '@/lib/server/tools/db';
import { runPythonTool } from '@/lib/server/tools/runner';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ toolId: string }>;
}

async function execute(req: NextRequest, { params }: Params, inputOverride?: unknown) {
  const { toolId } = await params;
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ ok: false, output: null, error: 'Tool runtime requires Supabase.' }, { status: 503 });
  const token = req.nextUrl.searchParams.get('token') ?? req.headers.get('x-reverie-tool-token') ?? '';
  if (!token) return NextResponse.json({ ok: false, output: null, error: 'Missing tool token.' }, { status: 401 });
  const supabase = createAdminSupabaseClient();
  let query = supabase
    .from('tools')
    .select('*')
    .eq('status', 'deployed');
  query = isUuid(toolId)
    ? query.eq('id', toolId)
    : query.or(`slug.eq.${toolId},endpoint_path.eq./run/${toolId}`);
  const { data: tool, error } = await query.maybeSingle();
  if (error || !tool) return NextResponse.json({ ok: false, output: null, error: 'Tool not found.' }, { status: 404 });
  if (tool.endpoint_token_hash !== hashToken(token)) {
    return NextResponse.json({ ok: false, output: null, error: 'Invalid tool token.' }, { status: 403 });
  }
  const { data: secretRows } = await supabase.from('tool_secrets').select('secret_key,secret_value').eq('tool_id', tool.id).eq('owner_id', tool.owner_id);
  const secrets = Object.fromEntries((secretRows ?? []).map((row) => [row.secret_key, decryptSecret(row.secret_value)]));
  const result = await runPythonTool({
    code: tool.code,
    dependencies: Array.isArray(tool.dependencies) ? tool.dependencies : [],
    inputs: inputOverride ?? {},
    secrets,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ toolId: string }> }) {
  return execute(req, ctx, {});
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ toolId: string }> }) {
  const input = await req.json().catch(() => ({}));
  return execute(req, ctx, input);
}
