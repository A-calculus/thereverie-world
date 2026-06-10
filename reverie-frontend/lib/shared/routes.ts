import { configuredBaseUrl, parseBaseUrl as parseConfiguredBaseUrl } from '@/lib/shared/base-url';

export type MainSection = 'docs' | 'agents' | 'apps' | 'marketplace' | 'tools' | 'mcp';

const internalSectionPath: Record<MainSection, string> = {
  docs: '/docs',
  agents: '/agents',
  apps: '/apps',
  marketplace: '/templates',
  tools: '/tools',
  mcp: '/mcp',
};

export function slugifyRoute(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
}

function currentBaseUrl() {
  return configuredBaseUrl();
}

function parseBaseUrl() {
  const value = currentBaseUrl();
  if (!value) return null;
  return parseConfiguredBaseUrl();
}

function supportsCanonicalSubdomains(base: URL) {
  return Boolean(base.hostname);
}

function withSubdomain(subdomain: MainSection, path = '/') {
  const base = parseConfiguredBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!base || !supportsCanonicalSubdomains(base)) {
    return `${internalSectionPath[subdomain]}${normalizedPath === '/' ? '' : normalizedPath}`;
  }
  const url = new URL(base.toString());
  url.hostname = `${subdomain}.${base.hostname.replace(/^(docs|agents|apps|marketplace|tools|mcp)\./, '')}`;
  url.pathname = normalizedPath;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function sectionUrl(section: MainSection, path = '/') {
  return withSubdomain(section, path);
}

export function agentUrl(agentId?: string, childPath = '') {
  const path = agentId ? `/${agentId}${childPath}` : childPath || '/';
  return sectionUrl('agents', path);
}

export function docsUrl(path = '/') {
  return sectionUrl('docs', path);
}

export function marketplaceUrl(path = '/') {
  return sectionUrl('marketplace', path);
}

export function toolsUrl(path = '/') {
  return sectionUrl('tools', path);
}

export function mcpUrl(path = '/') {
  return sectionUrl('mcp', path);
}

export function appsUrl(path = '/') {
  return sectionUrl('apps', path);
}

export function homeUrl() {
  const base = parseConfiguredBaseUrl();
  if (!base || !supportsCanonicalSubdomains(base)) return '/';
  base.pathname = '/';
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function dashboardUrl() {
  const base = parseBaseUrl();
  if (!base || !supportsCanonicalSubdomains(base)) return '/dashboard';
  base.pathname = '/dashboard';
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function loginUrl(redirect?: string) {
  const base = parseBaseUrl();
  if (!base || !supportsCanonicalSubdomains(base)) {
    return redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
  }
  base.pathname = '/login';
  base.search = '';
  base.hash = '';
  if (redirect) base.searchParams.set('redirect', redirect);
  return base.toString();
}

export function appRouteUrl(path: string | null | undefined) {
  if (!path) return dashboardUrl();
  if (/^https?:\/\//.test(path)) return path;

  const [pathname, query = ''] = path.split('?');
  const search = query ? `?${query}` : '';

  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    const base = parseConfiguredBaseUrl();
    base.pathname = pathname;
    base.search = query;
    base.hash = '';
    return base.toString();
  }
  if (pathname === '/agents' || pathname.startsWith('/agents/')) {
    return `${agentUrl(undefined, pathname.replace(/^\/agents/, '') || '/')}${search}`;
  }
  if (pathname === '/apps' || pathname.startsWith('/apps/')) {
    return `${appsUrl(pathname.replace(/^\/apps/, '') || '/')}${search}`;
  }
  if (pathname === '/templates' || pathname.startsWith('/templates/')) {
    return `${marketplaceUrl(pathname.replace(/^\/templates/, '') || '/')}${search}`;
  }
  if (pathname === '/tools' || pathname.startsWith('/tools/')) {
    return `${toolsUrl(pathname.replace(/^\/tools/, '') || '/')}${search}`;
  }
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
    return `${mcpUrl(pathname.replace(/^\/mcp/, '') || '/')}${search}`;
  }
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return `${docsUrl(pathname.replace(/^\/docs/, '') || '/')}${search}`;
  }
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return `${loginUrl()}${search}`;
  }

  const base = parseConfiguredBaseUrl();
  base.pathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  base.search = query;
  base.hash = '';
  return base.toString();
}

export function worldUrl(world: { id: string; name?: string | null; slug?: string | null }, childPath = '') {
  const base = parseBaseUrl();
  const worldSlug = slugifyRoute(world.slug || world.name || world.id);
  const normalizedChildPath = childPath ? (childPath.startsWith('/') ? childPath : `/${childPath}`) : '';
  if (!base || !supportsCanonicalSubdomains(base)) return `/apps/${world.id}${normalizedChildPath}`;
  const url = new URL(base.toString());
  url.hostname = `${worldSlug}.app.${base.hostname.replace(/^(docs|agents|apps|marketplace|tools|mcp)\./, '').replace(/^app\./, '')}`;
  url.pathname = `/${world.id}${normalizedChildPath}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
