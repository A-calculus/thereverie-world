import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { formatTool, type DbTool } from '@/lib/server/tools/db';
import { runPythonTool } from '@/lib/server/tools/runner';
import { DEFAULT_TOOL_CODE, DEFAULT_TOOL_INPUT, DEFAULT_TOOL_OUTPUT, parseDependencyText, slugifyTool, validateDependencyPins } from '@/lib/shared/tools';

export const runtime = 'nodejs';

function parseJsonValue(value: unknown, fallback: unknown) {
  if (typeof value !== 'string') return value ?? fallback;
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function dependenciesFrom(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return parseDependencyText(value);
  return [];
}

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ tools: [], source: 'demo' });

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  const { data, error } = await supabase
    .from('tools')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load tools' }, { status: 500 });
  return NextResponse.json({ tools: (data ?? []).map((tool) => formatTool(tool as DbTool, userId)) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? 'New Tool').trim();
  const slug = slugifyTool(String(body.slug ?? name));
  const code = String(body.code ?? DEFAULT_TOOL_CODE);
  const dependencies = dependenciesFrom(body.dependencies);
  const inputSample = parseJsonValue(body.inputSample, DEFAULT_TOOL_INPUT);
  const expectedOutput = parseJsonValue(body.expectedOutput, DEFAULT_TOOL_OUTPUT);
  const mcpMetadata = parseJsonValue(body.mcpMetadata, {});
  const dependencyError = validateDependencyPins(dependencies);
  if (dependencyError) return NextResponse.json({ error: dependencyError }, { status: 400 });

  const validation = await runPythonTool({ code, dependencies, inputs: inputSample, secrets: {} });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error ?? 'Tool validation failed.', validation }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      tool: {
        id: slug,
        slug,
        name,
        description: String(body.description ?? ''),
        status: 'draft',
        dependencies,
        inputSample,
        expectedOutput,
        mcpMetadata,
        endpointPath: null,
        endpointUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isOwner: true,
      },
      validation,
      source: 'demo',
    }, { status: 201 });
  }

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  const { data, error } = await supabase
    .from('tools')
    .upsert({
      owner_id: userId,
      slug,
      name,
      description: String(body.description ?? ''),
      code,
      dependencies,
      input_sample: inputSample,
      expected_output: expectedOutput,
      mcp_metadata: mcpMetadata,
      status: 'draft',
      last_validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,slug', ignoreDuplicates: false })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to save tool' }, { status: 500 });
  return NextResponse.json({ tool: formatTool(data as DbTool, userId), validation }, { status: 201 });
}
