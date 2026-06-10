import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { decryptSecret, hashToken } from '@/lib/server/tools/db';
import { runPythonTool } from '@/lib/server/tools/runner';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ capabilityId: string }>;
}

async function loadCapability(req: NextRequest, capabilityId: string) {
  if (!hasSupabaseAdminEnv()) return { error: 'MCP requires Supabase.' };
  const token = req.nextUrl.searchParams.get('token') ?? req.headers.get('x-reverie-mcp-token') ?? '';
  if (!token) return { error: 'Missing MCP token.' };
  const supabase = createAdminSupabaseClient();
  const { data: capability } = await supabase
    .from('tool_mcp_capabilities')
    .select('*')
    .eq('id', capabilityId)
    .maybeSingle();
  if (!capability || capability.token_hash !== hashToken(token)) return { error: 'Invalid MCP capability.' };
  if (capability.revoked_at) return { error: 'MCP capability has been revoked.' };
  if (capability.expires_at && new Date(capability.expires_at).getTime() <= Date.now()) return { error: 'MCP capability has expired.' };
  const toolIds = Array.isArray(capability.tool_ids) ? capability.tool_ids.filter((item: unknown): item is string => typeof item === 'string') : [];
  const { data: tools } = await supabase
    .from('tools')
    .select('*')
    .eq('owner_id', capability.owner_id)
    .eq('status', 'deployed')
    .in('id', toolIds);
  return { supabase, capability, tools: tools ?? [] };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { capabilityId } = await params;
  const loaded = await loadCapability(req, capabilityId);
  if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: 401 });
  return NextResponse.json({
    name: 'REVERIE Tools MCP',
    protocol: 'jsonrpc-2.0',
    tools: loaded.tools.map((tool) => ({ name: tool.slug, description: tool.description ?? '' })),
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { capabilityId } = await params;
  const body = await req.json().catch(() => ({}));
  const id = body.id ?? null;
  const loaded = await loadCapability(req, capabilityId);
  if ('error' in loaded) return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32001, message: loaded.error } }, { status: 401 });

  if (body.method === 'tools/list') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: loaded.tools.map((tool) => ({
          name: tool.slug,
          description: tool.description ?? '',
          inputSchema: tool.mcp_metadata?.inputSchema ?? { type: 'object' },
        })),
      },
    });
  }

  if (body.method === 'tools/call') {
    const paramsValue = body.params && typeof body.params === 'object' ? body.params as Record<string, unknown> : {};
    const name = String(paramsValue.name ?? paramsValue.toolName ?? '');
    const input = paramsValue.arguments ?? paramsValue.input ?? {};
    const tool = loaded.tools.find((item) => item.slug === name || item.id === name);
    if (!tool) return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Tool is not available in this MCP capability.' } }, { status: 404 });
    const { data: secretRows } = await loaded.supabase.from('tool_secrets').select('secret_key,secret_value').eq('tool_id', tool.id).eq('owner_id', tool.owner_id);
    const secrets = Object.fromEntries((secretRows ?? []).map((row) => [row.secret_key, decryptSecret(row.secret_value)]));
    const result = await runPythonTool({
      code: tool.code,
      dependencies: Array.isArray(tool.dependencies) ? tool.dependencies : [],
      inputs: input,
      secrets,
    });
    return NextResponse.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'json', json: result }], structuredContent: result } }, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unsupported MCP method.' } }, { status: 400 });
}
