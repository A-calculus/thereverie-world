'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Bot, Globe, Store, Settings, Zap, BookOpen, Database, GitBranch, Wrench } from 'lucide-react';
import { agentUrl, appsUrl, dashboardUrl, marketplaceUrl, toolsUrl, worldUrl } from '@/lib/shared/routes';
import type { LucideIcon } from 'lucide-react';
import { resolveEffectivePathname } from '@/lib/client/effective-pathname';

interface SidebarLink {
  name: string;
  href: string;
  icon: LucideIcon;
  activePrefix: string;
  exact?: boolean;
}

export function Sidebar({ effectivePathname, worldSlug }: { effectivePathname?: string; worldSlug?: string | null }) {
  const browserPathname = usePathname();
  const pathname = resolveEffectivePathname(browserPathname, effectivePathname);

  // If we're inside a specific world's builder view, show world-specific links
  const isWorldView = pathname?.includes('/apps/') && pathname.split('/').length > 3;
  const worldId = isWorldView ? pathname.split('/')[2] : null;
  const worldChildPath = isWorldView ? pathname.split('/')[3] : null;
  const reservedWorldPaths = new Set(['builder', 'state', 'agents', 'triggers', 'events', 'settings']);
  const runtimePath = worldChildPath && !reservedWorldPaths.has(worldChildPath) ? worldChildPath : worldSlug ?? worldId;

  const globalLinks: SidebarLink[] = [
    { name: 'Overview', href: dashboardUrl(), icon: LayoutDashboard, activePrefix: '/dashboard' },
    { name: 'My Agents', href: agentUrl(), icon: Bot, activePrefix: '/agents' },
    { name: 'My Worlds', href: appsUrl(), icon: Globe, activePrefix: '/apps' },
    { name: 'Tools', href: toolsUrl(), icon: Wrench, activePrefix: '/tools' },
    { name: 'Marketplace', href: marketplaceUrl(), icon: Store, activePrefix: '/templates' },
  ];

  const worldLinks: SidebarLink[] = worldId ? [
    { name: 'Dashboard', href: worldUrl({ id: worldId, slug: worldSlug ?? worldId }), icon: LayoutDashboard, activePrefix: `/apps/${worldId}`, exact: true },
    { name: 'Runtime', href: worldUrl({ id: worldId, slug: worldSlug ?? worldId }, runtimePath ? `/${runtimePath}` : ''), icon: GitBranch, activePrefix: runtimePath ? `/apps/${worldId}/${runtimePath}` : `/apps/${worldId}/runtime` },
    { name: 'Builder', href: worldUrl({ id: worldId, slug: worldSlug ?? worldId }, '/builder'), icon: Globe, activePrefix: `/apps/${worldId}/builder` },
    { name: 'World State', href: worldUrl({ id: worldId, slug: worldSlug ?? worldId }, '/state'), icon: Database, activePrefix: `/apps/${worldId}/state` },
    { name: 'Agents', href: worldUrl({ id: worldId, slug: worldSlug ?? worldId }, '/agents'), icon: Bot, activePrefix: `/apps/${worldId}/agents` },
    { name: 'Triggers', href: worldUrl({ id: worldId, slug: worldSlug ?? worldId }, '/triggers'), icon: Zap, activePrefix: `/apps/${worldId}/triggers` },
    { name: 'Event Stream', href: worldUrl({ id: worldId, slug: worldSlug ?? worldId }, '/events'), icon: BookOpen, activePrefix: `/apps/${worldId}/events` },
    { name: 'Settings', href: worldUrl({ id: worldId, slug: worldSlug ?? worldId }, '/settings'), icon: Settings, activePrefix: `/apps/${worldId}/settings` },
  ] : [];

  const links = isWorldView ? worldLinks : globalLinks;

  // Don't show sidebar on landing page, docs, or login
  const shouldHideSidebar = pathname === '/' || pathname === '/login' || pathname?.startsWith('/docs');

  return (
    <aside
      aria-hidden={shouldHideSidebar}
      className={`${shouldHideSidebar ? 'hidden' : 'hidden md:flex'} w-64 fixed left-0 top-16 bottom-0 border-r border-dream/20 bg-surface/50 backdrop-blur-xl p-4 flex-col z-40`}
    >
      <div className="mb-8 mt-4">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4 px-3">
          {isWorldView ? 'World Controls' : 'Main Menu'}
        </h2>
        <nav className="space-y-1">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = link.exact
              ? pathname === link.activePrefix
              : pathname === link.activePrefix || pathname?.startsWith(`${link.activePrefix}/`);
            
            return (
              <Link
                key={link.name}
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                  isActive 
                    ? 'bg-dream/20 text-teal' 
                    : 'text-text-primary hover:bg-dream/10 hover:text-aurora'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-teal' : 'text-dream/70'}`} />
                <span className="font-medium text-sm">{link.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {!isWorldView && (
        <div className="mt-auto glass-panel p-4 bg-void/30">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-teal animate-pulse" />
            <span className="text-xs font-medium text-teal">Somnia Testnet</span>
          </div>
          <p className="text-xs text-text-muted">Chain ID: 50312</p>
        </div>
      )}
    </aside>
  );
}
