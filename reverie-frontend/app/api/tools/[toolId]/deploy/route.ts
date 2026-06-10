import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { createBearerToken, decryptSecret, endpointPathFor, formatTool, hashToken, isUuid, metadataWithEndpointToken, type DbTool } from '@/lib/server/tools/db';
import { runPythonTool } from '@/lib/server/tools/runner';
import { parseDependencyText, toolRunUrl, validateDependencyPins } from '@/lib/shared/tools';

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
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required to deploy tools.' }, { status: 503 });
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  if (!userId) return NextResponse.json({ error: 'Unable to create user profile.' }, { status: 500 });
  let query = supabase
    .from('tools')
    .select('*')
    .eq('owner_id', userId);
  query = isUuid(toolId) ? query.eq('id', toolId) : query.eq('slug', toolId);
  const { data: tool, error } = await query.maybeSingle();
  if (error || !tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  const hasEditorPayload = Object.keys(body).length > 0;
  const dependencies = hasEditorPayload ? dependenciesFrom(body.dependencies) : (Array.isArray(tool.dependencies) ? tool.dependencies : []);
  const dependencyError = validateDependencyPins(dependencies);
  if (dependencyError) return NextResponse.json({ error: dependencyError }, { status: 400 });
  const code = hasEditorPayload && typeof body.code === 'string' ? body.code : tool.code;
  const inputSample = hasEditorPayload ? parseJsonValue(body.inputSample, tool.input_sample ?? {}) : tool.input_sample ?? {};
  const expectedOutput = hasEditorPayload ? parseJsonValue(body.expectedOutput, tool.expected_output ?? {}) : tool.expected_output ?? {};
  const mcpMetadata = hasEditorPayload ? parseJsonValue(body.mcpMetadata, tool.mcp_metadata ?? {}) : tool.mcp_metadata ?? {};
  const { data: secretRows } = await supabase.from('tool_secrets').select('secret_key,secret_value').eq('tool_id', tool.id).eq('owner_id', userId);
  const secrets = Object.fromEntries((secretRows ?? []).map((row) => [row.secret_key, decryptSecret(row.secret_value)]));
  const validation = await runPythonTool({
    code,
    dependencies,
    inputs: inputSample,
    secrets,
  });
  if (!validation.ok) return NextResponse.json({ error: validation.error ?? 'Tool validation failed.', validation }, { status: 400 });
  const token = createBearerToken();
  const endpointPath = endpointPathFor({ id: tool.id, slug: tool.slug });
  const storedMcpMetadata = metadataWithEndpointToken(mcpMetadata, token);
  const { data: updated, error: updateError } = await supabase
    .from('tools')
    .update({
      name: hasEditorPayload ? String(body.name ?? tool.name) : tool.name,
      description: hasEditorPayload ? String(body.description ?? tool.description ?? '') : tool.description,
      code,
      dependencies,
      input_sample: inputSample,
      expected_output: expectedOutput,
      mcp_metadata: storedMcpMetadata,
      status: 'deployed',
      endpoint_token_hash: hashToken(token),
      endpoint_path: endpointPath,
      last_validated_at: new Date().toISOString(),
      last_deployed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tool.id)
    .eq('owner_id', userId)
    .select('*')
    .single();
  if (updateError) return NextResponse.json({ error: 'Failed to deploy tool' }, { status: 500 });
  return NextResponse.json({
    tool: formatTool(updated as DbTool, userId, token),
    endpointUrl: toolRunUrl({ id: updated.id, slug: updated.slug }, token),
    validation,
  });
}
