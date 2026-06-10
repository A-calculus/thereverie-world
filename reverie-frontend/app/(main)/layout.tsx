import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { Footer } from '@/components/layout/footer';
import { getServerSession } from '@/lib/server/session';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getBaseSiteUrl } from '@/lib/server/auth-cookies';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { worldSlugFromHost } from '@/lib/shared/base-url';

async function getHeaderSession() {
  const session = await getServerSession();
  if (!session || !hasSupabaseAdminEnv()) return session;

  const supabase = createAdminSupabaseClient();
  const { data } = await supabase
    .from('users')
    .select('id,wallet_address,github_id,github_username,full_name,profile_pic_url,email')
    .eq('wallet_address', session.walletAddress)
    .maybeSingle();

  if (!data) return session;
  return {
    userId: data.id,
    walletAddress: data.wallet_address,
    githubId: data.github_id ?? undefined,
    githubUsername: data.github_username ?? undefined,
    fullName: data.full_name ?? undefined,
    profilePicUrl: data.profile_pic_url ?? undefined,
    email: data.email ?? undefined,
    iat: session.iat,
  };
}

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const headerStore = await headers();
  const pathname = headerStore.get('x-reverie-pathname') ?? '';
  const host = headerStore.get('host');
  const worldSlug = worldSlugFromHost(host);
  const isPublicDocs = pathname === '/docs' || pathname.startsWith('/docs/');
  const session = await getHeaderSession();

  if (pathname && !isPublicDocs && !session) {
    const loginUrl = getBaseSiteUrl(undefined, host);
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirect', pathname || '/dashboard');
    redirect(loginUrl.toString());
  }

  return (
    <div className="relative z-10 flex flex-col min-h-screen">
      <Header serverSession={session} effectivePathname={pathname} />
      <div className="flex flex-1 pt-16">
        <Sidebar effectivePathname={pathname} worldSlug={worldSlug} />
        <div className={`flex-1 flex flex-col min-h-[calc(100vh-4rem)] w-full ${isPublicDocs ? '' : 'md:ml-64'}`}>
          <main className="flex-1 p-6">
            {children}
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}
