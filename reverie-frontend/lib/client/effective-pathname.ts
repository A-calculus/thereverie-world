export function resolveEffectivePathname(browserPathname: string | null, fallbackPathname = '') {
  const pathname = browserPathname || '/';
  if (typeof window === 'undefined') return fallbackPathname || pathname;

  const hostParts = window.location.hostname.split('.');
  const section = hostParts[0];
  const appIndex = hostParts.indexOf('app');

  if (appIndex > 0) {
    return pathname === '/' ? '/apps' : `/apps${pathname}`;
  }

  if (section === 'agents' || section === 'agent') {
    return pathname === '/' ? '/agents' : `/agents${pathname}`;
  }
  if (section === 'apps' || section === 'app') {
    return pathname === '/' ? '/apps' : `/apps${pathname}`;
  }
  if (section === 'marketplace') {
    return pathname === '/' ? '/templates' : `/templates${pathname}`;
  }
  if (section === 'tools') {
    return pathname === '/' ? '/tools' : `/tools${pathname}`;
  }
  if (section === 'mcp') {
    return pathname === '/' ? '/mcp' : `/mcp${pathname}`;
  }
  if (section === 'docs') {
    return pathname === '/' ? '/docs' : `/docs${pathname}`;
  }

  return pathname;
}
