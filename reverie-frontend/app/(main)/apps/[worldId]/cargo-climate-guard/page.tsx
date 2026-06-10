'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowRight, GitBranch } from 'lucide-react';
import { worldUrl } from '@/lib/shared/routes';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import type { WorldRuntimeMetadata } from '@/lib/shared/types';

export default function CargoClimateGuardCompatibilityPage() {
  const params = useParams();
  const worldId = params.worldId as string;
  const hostWorldSlug = useWorldSlugFromHost();
  const [metadata, setMetadata] = useState<WorldRuntimeMetadata | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/apps/${worldId}/runtime`).then((res) => res.json()).then((data) => {
      if (!cancelled) setMetadata(data);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  const slug = metadata?.builder?.uiSlug ?? 'cargo-climate-guard';

  return (
    <div className="max-w-3xl mx-auto w-full glass-panel p-8">
      <div className="w-12 h-12 rounded-xl bg-teal/10 border border-teal/20 flex items-center justify-center text-teal mb-5">
        <GitBranch className="w-6 h-6" />
      </div>
      <h1 className="text-3xl font-display font-bold mb-2">{metadata?.builder?.displayName ?? 'World Runtime'}</h1>
      <p className="text-text-muted mb-6">
        This world now runs through the generic REVERIE runtime. Cargo Climate Guard is a template engine selected by builder config, not a dedicated frontend runtime.
      </p>
      <Link href={worldUrl({ id: worldId, name: metadata?.world.name, slug: hostWorldSlug }, `/${slug}`)} className="px-4 py-2 bg-teal text-void rounded-lg font-semibold inline-flex items-center gap-2">
        Open Generic Runtime <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
