import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { decryptSecret, isUuid } from '@/lib/server/tools/db';
import { runPythonTool } from '@/lib/server/tools/runner';
import { parseDependencyText } from '@/lib/shared/tools';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ toolId: string }>;
}

function dependenciesFrom(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return parseDependencyText(value);
  return [];
}

function parseJsonValue(value: unknown, fallback: unknown) {
  if (typeof value !== 'string') return value ?? fallback;
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { toolId } = await params;
  const body = await req.json().catch(() => ({}));
  let code = typeof body.code === 'string' ? body.code : '';
  let dependencies = dependenciesFrom(body.dependencies);
  let inputs = parseJsonValue(body.inputSample ?? body.inputs, {});
  let secrets: Record<string, string> = {};

  if (hasSupabaseAdminEnv()) {
    const supabase = createAdminSupabaseClient();
    const userId = await ensureSupabaseUser(session);
    let query = supabase
      .from('tools')
      .select('*')
      .eq('owner_id', userId);
    query = isUuid(toolId) ? query.eq('id', toolId) : query.eq('slug', toolId);
    const { data: tool } = await query.maybeSingle();
    if (tool) {
      code = code || tool.code;
      dependencies = dependencies.length ? dependencies : dependenciesFrom(tool.dependencies);
      inputs = body.inputSample !== undefined || body.inputs !== undefined ? inputs : tool.input_sample ?? {};
      const { data: secretRows } = await supabase.from('tool_secrets').select('secret_key,secret_value').eq('tool_id', tool.id).eq('owner_id', userId);
      secrets = Object.fromEntries((secretRows ?? []).map((row) => [row.secret_key, decryptSecret(row.secret_value)]));
    }
  }

  const result = await runPythonTool({ code, dependencies, inputs, secrets });
  return NextResponse.json({ validation: result, dependencies }, { status: result.ok ? 200 : 400 });
}
