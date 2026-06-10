import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { demoTemplates } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { ensureOfficialTemplatesSeeded, officialTemplateSlugs } from '@/lib/server/official-templates';
import type { WorldBuilderConfig } from '@/lib/shared/types';

interface Params {
  params: Promise<{ templateId: string }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function builderFromWorldConfig(worldConfig: unknown): WorldBuilderConfig | null {
  const config = objectValue(worldConfig);
  const worldState = objectValue(config.worldState ?? config);
  const builder = objectValue(worldState.builder ?? config.builder);
  return Object.keys(builder).length > 0 ? builder as unknown as WorldBuilderConfig : null;
}

function templateOverview(worldConfig: unknown) {
  const builder = builderFromWorldConfig(worldConfig);
  if (!builder) return undefined;
  return {
    inputs: (builder.inputSchema ?? []).map((input) => ({ id: input.id, label: input.label, type: input.type })),
    dataSources: (builder.dataSources ?? []).map((source) => ({ id: source.id, name: source.name, type: source.type, method: source.method ?? 'GET' })),
    zones: (builder.zones ?? []).map((zone) => ({ id: zone.id, name: zone.name, description: zone.description })),
    factions: (builder.factions ?? []).map((faction) => ({ id: faction.id, name: faction.name, description: faction.description })),
    agents: (builder.agentChain ?? []).map((agent) => ({ id: agent.agentId ?? agent.id, name: agent.name, type: agent.agentType, description: agent.purpose })),
    triggers: (builder.triggers ?? []).map((trigger) => ({ id: trigger.id, name: trigger.name, type: trigger.type, agents: trigger.agentChain ?? [] })),
    manualActions: (builder.manualActions ?? []).map((action) => ({ id: action.id, label: action.label, triggerId: action.triggerId })),
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { templateId } = await params;
  if (hasSupabaseAdminEnv()) {
    await ensureOfficialTemplatesSeeded();
    const session = await getServerSession();
    const userId = session ? await ensureSupabaseUser(session) : null;
    const supabase = createAdminSupabaseClient();
    const { data } = await supabase
      .from('templates')
      .select('*')
      .or(`id.eq.${templateId},slug.eq.${templateId}`)
      .maybeSingle();
    if (data) {
      if (data.creator_id === null && !officialTemplateSlugs.has(data.slug)) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      if (data.creator_id && data.creator_id !== userId && !data.is_public) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      return NextResponse.json({
        template: {
          id: data.id,
          slug: data.slug,
          name: data.name,
          author: data.creator_id ? (data.creator_id === userId ? 'You' : 'Community Builder') : 'REVERIE Official',
          downloads: String(data.download_count ?? 0),
          tags: [data.category],
          description: data.description ?? '',
          features: ['Configurable agents', 'Reusable world setup'],
          category: data.category,
          featured: data.featured,
          isPublic: data.is_public,
          isOwner: Boolean(userId && data.creator_id === userId),
          overview: templateOverview(data.world_config),
        },
      });
    }
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  const template = demoTemplates.find((item) => item.id === templateId || item.slug === templateId) ?? demoTemplates[0];
  return NextResponse.json({ template, source: 'demo' });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { templateId } = await params;
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ ok: true, deletedTemplateId: templateId, source: 'demo' });

  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const { data } = await supabase
    .from('templates')
    .select('id,slug,creator_id')
    .or(`id.eq.${templateId},slug.eq.${templateId}`)
    .maybeSingle();
  if (!data || data.creator_id !== userId) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  if (officialTemplateSlugs.has(data.slug) || data.creator_id === null) {
    return NextResponse.json({ error: 'Official templates cannot be deleted.' }, { status: 403 });
  }
  const { error } = await supabase.from('templates').delete().eq('id', data.id).eq('creator_id', userId);
  if (error) return NextResponse.json({ error: 'Failed to delete template.' }, { status: 500 });
  return NextResponse.json({ ok: true, deletedTemplateId: data.id });
}
