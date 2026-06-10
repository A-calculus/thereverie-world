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
}): Promise<{ builder: WorldBuilderConfig; snapshot: ResolutionSnapshot }> {
  return resolveBuilderForManifestCore({
    ...options,
    fetchDataSources: true,
    resolutionSource: 'browser_before_arm',
  });
}
