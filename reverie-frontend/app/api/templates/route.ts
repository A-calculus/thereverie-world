import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase-server';
import { demoTemplates } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv, hasSupabaseEnv } from '@/lib/server/supabase';
import { ensureOfficialTemplatesSeeded, officialTemplateSlugs } from '@/lib/server/official-templates';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get('scope');
  if (!hasSupabaseEnv()) return NextResponse.json({ templates: demoTemplates, source: 'demo' });

  try {
    await ensureOfficialTemplatesSeeded();
    const session = await getServerSession();
    const userId = session && hasSupabaseAdminEnv() ? await ensureSupabaseUser(session) : null;
    const supabase = scope === 'create' && hasSupabaseAdminEnv()
      ? createAdminSupabaseClient()
      : await createServerSupabaseClient();
    let query = supabase.from('templates').select('*').order('featured', { ascending: false });
    if (scope === 'create') {
      query = userId
        ? query.or(`creator_id.is.null,creator_id.eq.${userId}`)
        : query.is('creator_id', null);
    }
    const { data, error } = await query;
    if (error) throw error;

    const filtered = (data ?? []).filter((template) => (
      template.creator_id === userId || template.is_public || template.creator_id === null || officialTemplateSlugs.has(template.slug)
    ));

    return NextResponse.json({
      templates: filtered.map((template) => ({
        id: template.id,
        slug: template.slug,
        name: template.name,
        author: template.creator_id ? (template.creator_id === userId ? 'You' : 'Community Builder') : 'REVERIE Official',
        downloads: String(template.download_count ?? 0),
        tags: [template.category],
        description: template.description ?? '',
        features: ['Configurable agents', 'Reusable world setup'],
        category: template.category,
        featured: template.featured,
        isPublic: template.is_public,
        isOwner: Boolean(userId && template.creator_id === userId),
      })),
    });
  } catch (error) {
    console.error('GET /api/templates error:', error);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      template: {
        id: body.slug ?? body.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        slug: body.slug ?? body.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: body.name,
        author: 'You',
        downloads: '0',
        tags: body.tags ?? ['Custom'],
        description: body.description ?? '',
        features: body.features ?? ['Custom setup'],
        category: body.category ?? 'custom',
        featured: false,
        isPublic: Boolean(body.isPublic),
        isOwner: true,
      },
      source: 'demo',
    }, { status: 201 });
  }

  const supabase = createAdminSupabaseClient();
  const creatorId = await ensureSupabaseUser(session);
  const payload = {
      creator_id: creatorId,
      slug: body.slug ?? body.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: body.name,
      description: body.description,
      category: body.category ?? 'custom',
      world_config: body.worldConfig ?? {},
      is_public: body.isPublic ?? false,
      featured: false,
      updated_at: new Date().toISOString(),
    };
  const { data, error } = await supabase
    .from('templates')
    .upsert(payload, { onConflict: 'slug', ignoreDuplicates: false })
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  return NextResponse.json({
    template: {
      id: data.id,
      slug: data.slug,
      name: data.name,
      author: 'You',
      downloads: String(data.download_count ?? 0),
      tags: [data.category],
      description: data.description ?? '',
      features: body.features ?? ['Custom setup'],
      category: data.category,
      featured: data.featured,
      isPublic: data.is_public,
      isOwner: true,
    },
  }, { status: 201 });
}
