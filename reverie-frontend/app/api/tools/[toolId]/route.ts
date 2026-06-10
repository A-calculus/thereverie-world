import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { decryptSecret, formatTool, isUuid, type DbTool } from '@/lib/server/tools/db';
import { runPythonTool } from '@/lib/server/tools/runner';
import { parseDependencyText, validateDependencyPins } from '@/lib/shared/tools';

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

async function findTool(supabase: ReturnType<typeof createAdminSupabaseClient>, userId: string, toolId: string) {
  let query = supabase
    .from('tools')
    .select('*')
    .eq('owner_id', userId);
  query = isUuid(toolId) ? query.eq('id', toolId) : query.eq('slug', toolId);
  return query.maybeSingle();
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { toolId } = await params;
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  const { data, error } = await findTool(supabase, userId, toolId);
  if (error || !data) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  return NextResponse.json({ tool: { ...formatTool(data as DbTool, userId), code: data.code } });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { toolId } = await params;
  const body = await req.json().catch(() => ({}));
  const dependencies = dependenciesFrom(body.dependencies);
  const dependencyError = validateDependencyPins(dependencies);
  if (dependencyError) return NextResponse.json({ error: dependencyError }, { status: 400 });
  const code = String(body.code ?? '');
  const inputSample = parseJsonValue(body.inputSample, {});
  const expectedOutput = parseJsonValue(body.expectedOutput, {});
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required to save tools.' }, { status: 503 });
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  const existing = await findTool(supabase, userId, toolId);
  if (existing.error || !existing.data) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  const { data: secretRows } = await supabase.from('tool_secrets').select('secret_key,secret_value').eq('tool_id', existing.data.id).eq('owner_id', userId);
  const secrets = Object.fromEntries((secretRows ?? []).map((row) => [row.secret_key, decryptSecret(row.secret_value)]));
  const validation = await runPythonTool({ code, dependencies, inputs: inputSample, secrets });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error ?? 'Tool validation failed.', validation }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('tools')
    .update({
      name: String(body.name ?? existing.data.name),
      description: String(body.description ?? ''),
      code,
      dependencies,
      input_sample: inputSample,
      expected_output: expectedOutput,
      mcp_metadata: parseJsonValue(body.mcpMetadata, {}),
      status: existing.data.status === 'deployed' ? 'draft' : existing.data.status,
      last_validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.data.id)
    .eq('owner_id', userId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to save tool' }, { status: 500 });
  return NextResponse.json({ tool: { ...formatTool(data as DbTool, userId), code: data.code }, validation });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { toolId } = await params;
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ ok: true, source: 'demo' });
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  const existing = await findTool(supabase, userId, toolId);
  if (existing.error || !existing.data) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  const { error } = await supabase.from('tools').delete().eq('id', existing.data.id).eq('owner_id', userId);
  if (error) return NextResponse.json({ error: 'Failed to delete tool' }, { status: 500 });
  return NextResponse.json({ ok: true, deletedToolId: existing.data.id });
}
