import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { resolveWorldByIdOrSlug } from '@/lib/server/worlds';
import { builderFromWorld, compileSerializableManifest } from '@/lib/server/live-world';
import { resolveBuilderForServerManifest } from '@/lib/server/live-builder-resolution';
import { estimateRuntimeCost } from '@/lib/shared/world-runtime/lifecycle';

interface Params {
  params: Promise<{ worldId: string }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)];
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

function missingResolvedPathErrors(builder: Record<string, unknown>, snapshot: Record<string, unknown>) {
  const requirements = objectValue(objectValue(builder.config).liveRequirements);
  const errors: string[] = [];
  for (const requirement of arrayValue(requirements.resolvedPaths)) {
    const path = stringValue(requirement.path);
    if (!path) continue;
    const value = readPath(snapshot, path);
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      errors.push(`${stringValue(requirement.label, path)} is missing at ${path}.`);
    }
  }
  return errors;
}

export async function GET(_req: Request, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Connect the owner wallet to prepare live deployment.' }, { status: 401 });
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Supabase is required for live world deployment.' }, { status: 503 });

  const { worldId } = await params;
  const supabase = createAdminSupabaseClient();
  const userId = await ensureSupabaseUser(session);
  const world = await resolveWorldByIdOrSlug(supabase, worldId, { ownerId: userId });
  if (!world || world.owner_id !== userId) return NextResponse.json({ error: 'World not found.' }, { status: 404 });

  const rawBuilder = builderFromWorld(world);
  const state = typeof world.world_state === 'object' && world.world_state ? world.world_state as Record<string, unknown> : {};
  const publicState = typeof state.publicState === 'object' && state.publicState ? state.publicState as Record<string, unknown> : state;
  const { builder, snapshot } = await resolveBuilderForServerManifest({
    builder: rawBuilder,
    publicState,
    fetchDataSources: true,
  });
  if (!builder.lastPublishedAt) {
    return NextResponse.json({ error: 'Publish the world builder before preparing live deployment.' }, { status: 400 });
  }

  const manifest = compileSerializableManifest(builder);
  const costEstimate = estimateRuntimeCost(builder);
  const unsupported = Array.from(new Set([
    ...(Array.isArray(manifest.unsupported) ? manifest.unsupported.map(String) : []),
    ...missingResolvedPathErrors(builder as unknown as Record<string, unknown>, snapshot as Record<string, unknown>),
  ]));
  return NextResponse.json({
    world: {
      id: world.id,
      name: world.name,
      template: builder.uiSlug,
    },
    builder,
    manifest,
    resolvedInputSnapshot: snapshot,
    costEstimate,
    liveDeployable: unsupported.length === 0,
    unsupported,
  });
}
