export const DEV_BASE_URL = 'http://lvh.me:3000';

export const SECTION_SUBDOMAINS = new Set(['docs', 'agents', 'agent', 'apps', 'app', 'marketplace', 'tools', 'mcp']);

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

export function normalizeHostname(host: string | null | undefined) {
  if (!host) return null;
  return host.trim().toLowerCase().split(':')[0]?.replace(/^\.+|\.+$/g, '') || null;
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
