'use client';

import { useSyncExternalStore } from 'react';
import { worldSlugFromHost } from '@/lib/shared/base-url';

export function useWorldSlugFromHost() {
  return useSyncExternalStore(
    () => () => undefined,
    () => {
      if (typeof window === 'undefined') return null;
      return worldSlugFromHost(window.location.hostname);
    },
    () => null
  );
}

// Disabled stale helper: this previously combined the subdomain world slug
// with a caller-provided fallback, but no current route imports it. Keep the
// body here as documentation in case subdomain world routing needs this exact
// behavior again.
// export function useWorldSlugFallback(fallback: string) {
//   const hostSlug = useWorldSlugFromHost();
//   return hostSlug ?? fallback;
// }
