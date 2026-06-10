import 'server-only';

import type { WorldBuilderConfig } from '@/lib/shared/types';
import {
  resolveBuilderForManifestCore,
  type LiveResolutionSnapshot,
} from '@/lib/shared/live-builder-resolution-core';

export type ServerResolutionSnapshot = LiveResolutionSnapshot;

export async function resolveBuilderForServerManifest(options: {
  builder: WorldBuilderConfig;
  inputs?: Record<string, unknown>;
  publicState?: Record<string, unknown>;
  fetchDataSources?: boolean;
  baseUrl?: string | URL;
}): Promise<{ builder: WorldBuilderConfig; snapshot: ServerResolutionSnapshot }> {
  return resolveBuilderForManifestCore({
    ...options,
    resolutionSource: 'server_manifest_preview',
  });
}
