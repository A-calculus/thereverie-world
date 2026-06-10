import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { isOfficialCargoTemplateState } from '@/lib/server/official-templates';

interface Params {
  params: Promise<{ worldId: string }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world-template';
}

function sanitizeToolUrl(value: unknown) {
  if (typeof value !== 'string') return value;
  if (value.includes('/run/') || value.includes('token=')) return '';
  return value;
}

function sanitizeMcpUrls(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.filter((item) => typeof item === 'string' && !item.includes('token=') && !item.includes('/mcp/'));
}

function sanitizeBuilderForTemplate(value: unknown) {
  const builder = objectValue(value);
  const agentIdMap = new Map<string, string>();
  const agentChain = Array.isArray(builder.agentChain)
    ? builder.agentChain.map((step, index) => {
        const record = objectValue(step);
        const oldId = typeof record.agentId === 'string' ? record.agentId : String(record.id ?? `agent-${index + 1}`);
        const nextId = `template-agent-${index + 1}-${slugify(String(record.name ?? 'agent'))}`;
        agentIdMap.set(oldId, nextId);
        agentIdMap.set(String(record.id ?? oldId), nextId);
        return {
          ...record,
          id: nextId,
          agentId: undefined,
          outputSchema: objectValue(record.outputSchema),
        };
      })
    : [];
  return {
    ...builder,
    dataSources: Array.isArray(builder.dataSources)
      ? builder.dataSources.map((source) => {
          const record = objectValue(source);
          return {
            ...record,
            url: sanitizeToolUrl(record.url),
            sampleResponse: undefined,
          };
        })
      : [],
    agentChain,
    triggers: Array.isArray(builder.triggers)
      ? builder.triggers.map((trigger) => {
          const record = objectValue(trigger);
          const chain = Array.isArray(record.agentChain)
            ? record.agentChain.map((agentId) => agentIdMap.get(String(agentId)) ?? String(agentId))
            : [];
          return { ...record, agentChain: chain };
        })
      : [],
    graph: builder.graph && typeof builder.graph === 'object' && !Array.isArray(builder.graph)
      ? {
          ...objectValue(builder.graph),
          nodes: Array.isArray(objectValue(builder.graph).nodes)
            ? (objectValue(builder.graph).nodes as unknown[]).map((node) => {
                const record = objectValue(node);
                if (record.type !== 'agent') return record;
                const oldRef = String(record.refId ?? String(record.id ?? '').replace(/^agent:/, ''));
                const nextId = agentIdMap.get(oldRef);
                return nextId ? { ...record, id: `agent:${nextId}`, refId: nextId } : record;
              })
            : [],
          edges: Array.isArray(objectValue(builder.graph).edges)
            ? (objectValue(builder.graph).edges as unknown[]).map((edge) => {
                const record = objectValue(edge);
                const source = String(record.source ?? '');
                const target = String(record.target ?? '');
                const sourceAgent = source.startsWith('agent:') ? agentIdMap.get(source.slice('agent:'.length)) : null;
                const targetAgent = target.startsWith('agent:') ? agentIdMap.get(target.slice('agent:'.length)) : null;
                return {
                  ...record,
                  source: sourceAgent ? `agent:${sourceAgent}` : source,
                  target: targetAgent ? `agent:${targetAgent}` : target,
                };
              })
            : [],
        }
      : builder.graph,
    config: {
      ...objectValue(builder.config),
      mcpServerUrls: sanitizeMcpUrls(objectValue(builder.config).mcpServerUrls),
      endpointUrl: undefined,
      endpointPath: undefined,
    },
  };
}

function sanitizeWorldStateForTemplate(state: Record<string, unknown>, requiredSecretKeys: string[]) {
  const rest = { ...state };
  delete rest.deployment;
  delete rest.runtime;
  delete rest.latestRun;
  delete rest.latestTick;
  delete rest.fundingHistory;
  delete rest.stopReason;
  delete rest.runtimeStartedAt;
  delete rest.runtimeStoppedAt;
  rest.agents = [];
  rest.builder = sanitizeBuilderForTemplate(rest.builder);
  return {
    ...rest,
    requiredSecretKeys,
    templateSource: {
      snapshotMode: 'from_world',
      excludesSecretValues: true,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { worldId } = await params;
  const body = await req.json().catch(() => ({}));
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Creating templates from worlds requires Supabase.' }, { status: 503 });

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 });
  const state = objectValue(world.world_state);
  const { data: secretRows } = await supabase
    .from('world_secrets')
    .select('secret_key')
    .eq('world_id', world.id)
    .eq('owner_id', userId);
  const builderSecrets = Array.isArray(objectValue(state.builder).secrets)
    ? (objectValue(state.builder).secrets as Array<{ key?: unknown }>).map((item) => typeof item.key === 'string' ? item.key : '').filter(Boolean)
    : [];
  const requiredSecretKeys = Array.from(new Set([
    ...builderSecrets,
    ...(secretRows ?? []).map((row) => String(row.secret_key)),
  ])).sort();
  const name = String(body.name ?? `${world.name} Template`).trim();
  const worldConfig = sanitizeWorldStateForTemplate(state, requiredSecretKeys);
  if (body.replaceOfficialSlug === 'cargo-climate-guard') {
    if (world.status !== 'running') {
      return NextResponse.json({ error: 'Official Cargo template replacement requires a running source world.' }, { status: 400 });
    }
    if (!isOfficialCargoTemplateState(state)) {
      return NextResponse.json({ error: 'Official Cargo template replacement requires a Cargo Climate Guard world.' }, { status: 400 });
    }
    const { data, error } = await supabase.from('templates').upsert({
      creator_id: null,
      slug: 'cargo-climate-guard',
      name: 'Cargo Climate Guard',
      description: 'Sea-route weather system with rerouting, on-chain reactivity, receipts, and STOP_WORLD behavior for unsafe realtime routes.',
      category: 'supply_chain',
      world_config: {
        worldState: worldConfig,
        sourceWorldName: world.name,
        sourceWorldId: world.id,
        requiredSecretKeys,
        officialReplacement: true,
        replacedAt: new Date().toISOString(),
      },
      is_public: true,
      featured: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'slug', ignoreDuplicates: false }).select().single();
    if (error) return NextResponse.json({ error: 'Failed to replace official Cargo template.' }, { status: 500 });
    return NextResponse.json({
      template: {
        id: data.id,
        slug: data.slug,
        name: data.name,
        author: 'REVERIE Official',
        downloads: String(data.download_count ?? 0),
        tags: [data.category],
        description: data.description ?? '',
        features: ['World snapshot', 'Copied agents', 'Copied triggers', 'Official Cargo runtime'],
        category: data.category,
        featured: data.featured,
        isPublic: data.is_public,
        isOwner: false,
      },
      official: true,
    });
  }

  const slug = `${slugify(name)}-${Date.now().toString(36)}`;
  const { data, error } = await supabase.from('templates').insert({
    creator_id: userId,
    slug,
    name,
    description: String(body.description ?? `Snapshot template created from ${world.name}.`),
    category: body.category ?? 'custom',
    world_config: {
      worldState: worldConfig,
      sourceWorldName: world.name,
      requiredSecretKeys,
    },
    is_public: Boolean(body.isPublic),
    featured: false,
    updated_at: new Date().toISOString(),
  }).select().single();
  if (error) return NextResponse.json({ error: 'Failed to create template from world.' }, { status: 500 });
  return NextResponse.json({
    template: {
      id: data.id,
      slug: data.slug,
      name: data.name,
      author: 'You',
      downloads: String(data.download_count ?? 0),
      tags: [data.category],
      description: data.description ?? '',
      features: ['World snapshot', 'Copied agents', 'Copied triggers'],
      category: data.category,
      featured: data.featured,
      isPublic: data.is_public,
      isOwner: true,
    },
  }, { status: 201 });
}
