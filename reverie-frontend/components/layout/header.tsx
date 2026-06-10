'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Copy, LogOut, GitBranch, ChevronDown, Check } from 'lucide-react';
import { useAuthStore, type User } from '@/lib/auth/store';
import { useUserProfile } from '@/lib/hooks/useUserProfile';
import { getProfileDisplayName, truncateWallet } from '@/lib/shared/profile';
import { clearClientCache, flushClientCacheToServer, setCachedValue, updateCachedProfile } from '@/lib/client/query-cache';
import { agentUrl, appsUrl, dashboardUrl, docsUrl, homeUrl, loginUrl, marketplaceUrl } from '@/lib/shared/routes';
import { resolveEffectivePathname } from '@/lib/client/effective-pathname';

interface HeaderSession {
  walletAddress: string;
  userId: string;
  githubId?: string;
  githubUsername?: string;
  fullName?: string;
  profilePicUrl?: string;
  email?: string;
}

function sessionToUser(session: HeaderSession) {
  return {
    id: session.userId,
    walletAddress: session.walletAddress,
    githubId: session.githubId,
    githubUsername: session.githubUsername,
    fullName: session.fullName,
    profilePicUrl: session.profilePicUrl,
    email: session.email,
  };
}

type HeaderUser = User | ReturnType<typeof sessionToUser> | null;

function usersMatch(left: HeaderUser, right: HeaderUser) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.walletAddress === right.walletAddress &&
    left.githubId === right.githubId &&
    left.githubUsername === right.githubUsername &&
    left.fullName === right.fullName &&
    left.profilePicUrl === right.profilePicUrl &&
    left.email === right.email
  );
}

export function Header({ serverSession, effectivePathname }: { serverSession?: HeaderSession | null; effectivePathname?: string }) {
  const browserPathname = usePathname();
  const pathname = resolveEffectivePathname(browserPathname, effectivePathname);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [profileAction, setProfileAction] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { user, logout, setGithubProfile, setUser } = useAuthStore();
  useUserProfile();
  const serverUser = serverSession ? sessionToUser(serverSession) : null;
  const effectiveUser = user ?? serverUser;
  const walletAddress = effectiveUser?.walletAddress ?? '';
  const displayName = getProfileDisplayName(effectiveUser);
  const hasGithubProfile = Boolean(effectiveUser?.githubUsername || effectiveUser?.email || effectiveUser?.fullName || effectiveUser?.profilePicUrl);

  const navLinks = [
    ...(walletAddress ? [
    { name: 'Dashboard', href: dashboardUrl(), activePrefix: '/dashboard' },
    { name: 'Agents', href: agentUrl(), activePrefix: '/agents' },
    { name: 'Worlds', href: appsUrl(), activePrefix: '/apps' },
    { name: 'Marketplace', href: marketplaceUrl(), activePrefix: '/templates' },
    ] : []),
    { name: 'Docs', href: docsUrl(), activePrefix: '/docs' },
  ];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!serverUser || usersMatch(user, serverUser)) return;
    setUser(serverUser);
    setCachedValue('profile', serverUser);
  }, [serverUser, setUser, user]);

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const disconnectGithub = async () => {
    setProfileAction('disconnectGithub');
    try {
      await fetch('/api/auth/github/disconnect', { method: 'POST' }).catch(() => undefined);
      setGithubProfile({
        githubId: undefined,
        githubUsername: undefined,
        fullName: undefined,
        profilePicUrl: undefined,
        email: undefined,
      });
      updateCachedProfile({
        githubUsername: undefined,
        fullName: undefined,
        profilePicUrl: undefined,
        email: undefined,
      });
      setDropdownOpen(false);
    } finally {
      setProfileAction(null);
    }
  };

  const connectGithub = async () => {
    setProfileAction('connectGithub');
    await flushClientCacheToServer();
    setDropdownOpen(false);
    const params = new URLSearchParams({
      wallet: walletAddress,
      returnTo: `${window.location.pathname}${window.location.search}`,
    });
    window.location.href = `/api/auth/github?${params.toString()}`;
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-16 z-50 border-b border-dream/20 bg-void/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-full flex items-center justify-between">
        <div className="flex items-center space-x-4 md:space-x-8">
          <button 
            className="md:hidden text-text-muted hover:text-aurora"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <Link href={homeUrl()} className="flex items-center space-x-2">
            <span className="font-display text-xl md:text-2xl font-semibold tracking-[0.18em] text-gradient">REVERIE</span>
          </Link>

          <nav className="hidden md:flex items-center space-x-6">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                className={`text-sm font-medium transition-colors hover:text-aurora ${pathname?.startsWith(link.activePrefix) ? 'text-teal' : 'text-text-muted'
                  }`}
              >
                {link.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          {!walletAddress ? (
            <Link href={loginUrl()} className="bg-dream hover:bg-aurora text-void px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
              Connect Wallet
            </Link>
          ) : (
                      <div className="relative" ref={dropdownRef}>
                        <button
                          onClick={() => setDropdownOpen(!dropdownOpen)}
                          className="flex items-center gap-2 bg-surface border border-dream/20 hover:border-dream/40 px-3 py-1.5 rounded-lg transition-colors"
                          type="button"
                        >
                          {effectiveUser?.profilePicUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={effectiveUser.profilePicUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-dream to-teal flex items-center justify-center text-xs text-void font-bold">
                              {displayName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm font-medium hidden sm:block max-w-36 truncate">{displayName}</span>
                          <ChevronDown className="w-4 h-4 text-text-muted" />
                        </button>

                        {dropdownOpen && (
                          <div className="absolute right-0 mt-2 w-56 bg-void border border-dream/20 rounded-xl shadow-[0_4px_30px_rgba(0,0,0,0.5)] overflow-hidden z-50 p-1">
                            <div className="p-3 border-b border-dream/10 mb-1">
                              <p className="text-xs text-text-muted mb-1">Connected as</p>
                              <p className="text-sm font-medium truncate">{displayName}</p>
                              <p className="text-xs font-mono text-text-muted mt-1">{truncateWallet(walletAddress)}</p>
                            </div>
                            
                            <button
                              onClick={() => { copyAddress(walletAddress); }}
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-surface rounded-lg transition-colors text-left"
                            >
                              {copied ? <Check className="w-4 h-4 text-teal" /> : <Copy className="w-4 h-4 text-text-muted" />}
                              {copied ? 'Copied!' : 'Copy Address'}
                            </button>
                            
                            {hasGithubProfile ? (
                              <button
                                onClick={disconnectGithub}
                                disabled={Boolean(profileAction)}
                                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-surface rounded-lg transition-colors text-left disabled:opacity-60"
                              >
                                {profileAction === 'disconnectGithub' ? <div className="w-4 h-4 border-2 border-aurora/30 border-t-aurora rounded-full animate-spin" /> : <GitBranch className="w-4 h-4 text-aurora" />}
                                {profileAction === 'disconnectGithub' ? 'Disconnecting...' : 'Disconnect GitHub'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={connectGithub}
                                disabled={Boolean(profileAction)}
                                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-surface rounded-lg transition-colors text-left disabled:opacity-60"
                              >
                                {profileAction === 'connectGithub' ? <div className="w-4 h-4 border-2 border-aurora/30 border-t-aurora rounded-full animate-spin" /> : <GitBranch className="w-4 h-4 text-aurora" />}
                                {profileAction === 'connectGithub' ? 'Connecting...' : 'Connect to GitHub'}
                              </button>
                            )}
                            
                            <div className="h-px bg-dream/10 my-1 mx-2" />
                            
                            <button
                              onClick={async () => {
                                setProfileAction('logout');
                                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
                                clearClientCache();
                                logout();
                                setDropdownOpen(false);
                                window.location.href = loginUrl();
                              }}
                              disabled={Boolean(profileAction)}
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors text-left disabled:opacity-60"
                            >
                              {profileAction === 'logout' ? <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" /> : <LogOut className="w-4 h-4" />}
                              {profileAction === 'logout' ? 'Disconnecting...' : 'Disconnect'}
                            </button>
                          </div>
                        )}
                      </div>
          )}
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 bg-void/95 backdrop-blur-xl border-b border-dream/20 p-4 shadow-xl flex flex-col gap-2">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className={`p-3 rounded-lg text-sm font-medium transition-colors ${pathname?.startsWith(link.activePrefix) ? 'bg-dream/20 text-teal' : 'text-text-primary hover:bg-surface'
                }`}
            >
              {link.name}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
