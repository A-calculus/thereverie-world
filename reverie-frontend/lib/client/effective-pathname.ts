import { effectivePathnameFromHost } from '@/lib/shared/base-url';

export function resolveEffectivePathname(browserPathname: string | null, fallbackPathname = '') {
  const pathname = browserPathname || '/';
  if (typeof window === 'undefined') return fallbackPathname || pathname;
  return effectivePathnameFromHost(window.location.hostname, pathname);
}
