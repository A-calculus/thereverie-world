import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { REVERIE_SESSION_COOKIE } from '@/lib/server/auth-cookies';
import { effectivePathnameFromHost, isAppSubdomainHost, parseBaseUrl, usesSubdomainRouting } from '@/lib/shared/base-url';

const PROTECTED_ROUTES = ['/dashboard', '/agents', '/apps', '/templates', '/tools'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get('host')?.split(':')[0] ?? '';
  const requestHeaders = new Headers(request.headers);
  const canonicalRedirect = resolveCanonicalRedirect(request);
  if (canonicalRedirect) return canonicalRedirect;

  const base = publicBaseUrl();
  const rewrittenPath = !base || usesSubdomainRouting(base) ? resolveSubdomainPath(host, pathname) : null;
  const effectivePathname = rewrittenPath ?? pathname;
  const isPublicToolRun = effectivePathname.startsWith('/tools/run/');
  const isProtected = !isPublicToolRun && PROTECTED_ROUTES.some((route) => effectivePathname.startsWith(route));
  requestHeaders.set('x-reverie-pathname', effectivePathname);

  if (isProtected) {
    const sessionToken = request.cookies.get(REVERIE_SESSION_COOKIE)?.value;

    if (!sessionToken) {
      const loginUrl = loginUrlFor(request);
      loginUrl.searchParams.set('redirect', effectivePathname);
      return NextResponse.redirect(loginUrl.toString());
    }
  }

  if (rewrittenPath) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = rewrittenPath;
    return NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

function resolveSubdomainPath(host: string, pathname: string): string | null {
  if (isPublicSystemPath(pathname)) return null;
  const base = publicBaseUrl();
  if (!base || !usesSubdomainRouting(base)) return null;
  const effectivePath = effectivePathnameFromHost(host, pathname, base);
  if (effectivePath === pathname) return null;
  if (effectivePath === '/tools/run' || effectivePath.startsWith('/tools/run/')) {
    return `/api${effectivePath}`;
  }
  return effectivePath;
}

function isPublicSystemPath(pathname: string) {
  return pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/logo.png';
}

function resolveCanonicalRedirect(request: NextRequest): NextResponse | null {
  const base = publicBaseUrl();
  if (!base) return null;
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get('host')?.split(':')[0] ?? '';
  if ((pathname === '/login' || pathname.startsWith('/login/')) && host !== base.hostname) {
    const loginUrl = new URL(base.toString());
    loginUrl.pathname = pathname;
    loginUrl.search = search;
    return NextResponse.redirect(loginUrl.toString());
  }
  if ((pathname === '/dashboard' || pathname.startsWith('/dashboard/')) && host !== base.hostname) {
    const dashboardUrl = new URL(base.toString());
    dashboardUrl.pathname = pathname;
    dashboardUrl.search = search;
    return NextResponse.redirect(dashboardUrl.toString());
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/') || pathname === '/login') return null;
  if (!usesSubdomainRouting(base)) return null;

  if (pathname === '/apps' || pathname === '/apps/') return redirectTo(base, 'apps', '/', search);
  if (pathname === '/apps/create') return redirectTo(base, 'apps', '/create', search);
  if (pathname.startsWith('/apps/')) {
    const segments = pathname.split('/').filter(Boolean);
    const worldId = segments[1];
    if (!worldId) return redirectTo(base, 'apps', '/');
    const childPath = segments.length > 2 ? `/${segments.slice(2).join('/')}` : '';
    const url = new URL(base.toString());
    url.hostname = `${slugify(worldId)}.app.${base.hostname}`;
    url.pathname = `/${worldId}${childPath}`;
    url.search = search;
    return NextResponse.redirect(url);
  }

  if (pathname === '/agents' || pathname.startsWith('/agents/')) {
    return redirectTo(base, 'agents', pathname.replace(/^\/agents/, '') || '/', search);
  }
  if (pathname === '/templates' || pathname.startsWith('/templates/')) {
    return redirectTo(base, 'marketplace', pathname.replace(/^\/templates/, '') || '/', search);
  }
  if (pathname === '/tools' || pathname.startsWith('/tools/')) {
    return redirectTo(base, 'tools', pathname.replace(/^\/tools/, '') || '/', search);
  }
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
    return redirectTo(base, 'mcp', pathname.replace(/^\/mcp/, '') || '/', search);
  }
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return redirectTo(base, 'docs', pathname.replace(/^\/docs/, '') || '/', search);
  }

  if (isCanonicalHost(host, base.hostname)) return null;
  return null;
}

function publicBaseUrl(): URL | null {
  try {
    return parseBaseUrl();
  } catch {
    return null;
  }
}

function loginUrlFor(request: NextRequest) {
  const base = publicBaseUrl();
  if (base) {
    base.pathname = '/login';
    base.search = '';
    return base;
  }
  const url = new URL('/login', request.url);
  const host = request.headers.get('host') ?? url.host;
  const hostname = host.split(':')[0];
  const port = host.includes(':') ? `:${host.split(':')[1]}` : '';
  const stripped = hostname
    .replace(/^(docs|agents|agent|apps|app|marketplace|tools|mcp)\./, '')
    .replace(/^[^.]+\.app\./, '');
  url.host = `${stripped}${port}`;
  return url;
}

function redirectTo(base: URL, subdomain: string, path: string, search = '') {
  const url = new URL(base.toString());
  url.hostname = `${subdomain}.${base.hostname}`;
  url.pathname = path.startsWith('/') ? path : `/${path}`;
  url.search = search;
  return NextResponse.redirect(url.toString());
}

function isCanonicalHost(host: string, baseHost: string) {
  const base = publicBaseUrl();
  return host === baseHost ||
    host === `docs.${baseHost}` ||
    host === `agents.${baseHost}` ||
    host === `apps.${baseHost}` ||
    host === `marketplace.${baseHost}` ||
    host === `tools.${baseHost}` ||
    host === `mcp.${baseHost}` ||
    Boolean(base && isAppSubdomainHost(host, base));
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
