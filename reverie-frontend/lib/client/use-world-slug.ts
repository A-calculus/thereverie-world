'use client';

import { useSyncExternalStore } from 'react';

export function useWorldSlugFromHost() {
  return useSyncExternalStore(
    () => () => undefined,
    () => {
      if (typeof window === 'undefined') return null;
      const parts = window.location.hostname.split('.');
      const appIndex = parts.indexOf('app');
      return appIndex > 0 ? parts.slice(0, appIndex).join('.') : null;
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
