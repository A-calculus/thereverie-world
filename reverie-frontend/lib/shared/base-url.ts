export const DEV_BASE_URL = 'http://lvh.me:3000';

export const SECTION_SUBDOMAINS = new Set(['docs', 'agents', 'agent', 'apps', 'app', 'marketplace', 'tools', 'mcp']);

export type ReverieRoutingMode = 'path' | 'subdomain';

export function configuredBaseUrl() {
  return process.env.NEXT_PUBLIC_REVERIE_BASE_URL || process.env.NEXT_PUBLIC_REVERIE_BASE_DOMAIN || DEV_BASE_URL;
}

export function parseBaseUrl(value = configuredBaseUrl()) {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    return new URL(DEV_BASE_URL);
  }
}

export function canonicalBaseUrl() {
  const url = parseBaseUrl();
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

export function reverieRoutingMode(base = canonicalBaseUrl()): ReverieRoutingMode {
  const configured = process.env.NEXT_PUBLIC_REVERIE_ROUTING_MODE?.trim().toLowerCase();
  if (configured === 'path' || configured === 'subdomain') return configured;

  const hostname = normalizeHostname(base.hostname);
  if (!hostname) return 'path';
  if (hostname === 'lvh.me' || hostname.endsWith('.lvh.me')) return 'subdomain';
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'path';
  if (hostname.endsWith('.vercel.app')) return 'path';
  return 'subdomain';
}

export function usesSubdomainRouting(base = canonicalBaseUrl()) {
  return reverieRoutingMode(base) === 'subdomain';
}

export function normalizeHostname(host: string | null | undefined) {
  if (!host) return null;
  return host.trim().toLowerCase().split(':')[0]?.replace(/^\.+|\.+$/g, '') || null;
}

function normalizedPathname(pathname: string | null | undefined) {
  const path = pathname || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function baseHostname(base: URL) {
  return normalizeHostname(base.hostname);
}

function sectionSubdomainFromHost(host: string | null | undefined, base = canonicalBaseUrl()) {
  if (!usesSubdomainRouting(base)) return null;
  const hostname = normalizeHostname(host);
  const rootHost = baseHostname(base);
  if (!hostname || !rootHost) return null;

  for (const section of SECTION_SUBDOMAINS) {
    if (hostname === `${section}.${rootHost}`) return section;
  }

  return null;
}

function prefixedPath(prefix: string, path: string) {
  if (path === prefix || path.startsWith(`${prefix}/`)) return path;
  return path === '/' ? prefix : `${prefix}${path}`;
}

export function isAppSubdomainHost(host: string | null | undefined, base = canonicalBaseUrl()) {
  if (!usesSubdomainRouting(base)) return false;
  const hostname = normalizeHostname(host);
  const rootHost = baseHostname(base);
  if (!hostname || !rootHost) return false;
  return hostname.endsWith(`.app.${rootHost}`) && hostname !== `app.${rootHost}`;
}

export function worldSlugFromHost(host: string | null | undefined, base = canonicalBaseUrl()) {
  if (!isAppSubdomainHost(host, base)) return null;
  const hostname = normalizeHostname(host);
  const rootHost = baseHostname(base);
  if (!hostname || !rootHost) return null;
  return hostname.slice(0, -`.app.${rootHost}`.length) || null;
}

export function effectivePathnameFromHost(
  host: string | null | undefined,
  pathname: string | null | undefined,
  base = canonicalBaseUrl(),
) {
  const path = normalizedPathname(pathname);
  if (!usesSubdomainRouting(base)) return path;

  if (isAppSubdomainHost(host, base)) {
    return prefixedPath('/apps', path);
  }

  const section = sectionSubdomainFromHost(host, base);
  if (section === 'agents' || section === 'agent') return prefixedPath('/agents', path);
  if (section === 'apps' || section === 'app') return prefixedPath('/apps', path);
  if (section === 'marketplace') return prefixedPath('/templates', path);
  if (section === 'tools') return prefixedPath('/tools', path);
  if (section === 'mcp') return prefixedPath('/mcp', path);
  if (section === 'docs') return prefixedPath('/docs', path);

  return path;
}

export function baseDomainFromHostname(hostname: string) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'localhost';

  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;

  const appIndex = parts.indexOf('app');
  if (appIndex > 0 && parts.length > appIndex + 2) {
    return parts.slice(appIndex + 1).join('.');
  }

  if (SECTION_SUBDOMAINS.has(parts[0])) {
    return parts.slice(1).join('.');
  }

  return hostname;
}
