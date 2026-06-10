import { baseDomainFromHostname, canonicalBaseUrl, normalizeHostname } from '@/lib/shared/base-url';

export const REVERIE_SESSION_COOKIE = 'reverie-session';
export const REVERIE_GITHUB_LINK_COOKIE = 'reverie-github-link';

function configuredHost() {
  return canonicalBaseUrl().hostname;
}

function isIpAddress(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

export function getSharedCookieDomain(host?: string | null) {
  const hostname = normalizeHostname(configuredHost() ?? host);
  if (!hostname) return undefined;

  if (isIpAddress(hostname)) return undefined;
  const domain = baseDomainFromHostname(hostname);
  if (domain === 'localhost') return undefined;
  return domain ?? undefined;
}

export function getBaseSiteUrl(_requestUrl?: string, _host?: string | null) {
  void _requestUrl;
  void _host;
  return canonicalBaseUrl();
}

export function sessionCookieOptions(host?: string | null) {
  const domain = getSharedCookieDomain(host);
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

export function expiredSessionCookieOptions(host?: string | null) {
  return {
    ...sessionCookieOptions(host),
    maxAge: 0,
  };
}

export function githubLinkCookieOptions(host?: string | null) {
  const domain = getSharedCookieDomain(host);
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 10 * 60,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

export function expiredGithubLinkCookieOptions(host?: string | null) {
  return {
    ...githubLinkCookieOptions(host),
    maxAge: 0,
  };
}

export function withSharedCookieDomain<T extends object>(options: T, host?: string | null) {
  const domain = getSharedCookieDomain(host);
  return domain ? { ...options, domain } : options;
}
