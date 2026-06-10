'use client';

import type { WorldBuilderConfig } from '@/lib/shared/types';
import {
  resolveBuilderForManifestCore,
  type LiveResolutionSnapshot,
} from '@/lib/shared/live-builder-resolution-core';

export type ResolutionSnapshot = LiveResolutionSnapshot;

export async function resolveBuilderForLiveManifest(options: {
  builder: WorldBuilderConfig;
  inputs?: Record<string, unknown>;
  publicState?: Record<string, unknown>;
  baseUrl?: string | URL;
}): Promise<{ builder: WorldBuilderConfig; snapshot: ResolutionSnapshot }> {
  return resolveBuilderForManifestCore({
    ...options,
    baseUrl: options.baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : undefined),
    fetchDataSources: true,
    resolutionSource: 'browser_before_arm',
  });
}
