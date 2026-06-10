import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseEnv } from '@/lib/server/supabase';
import { getBaseSiteUrl, githubLinkCookieOptions, REVERIE_GITHUB_LINK_COOKIE } from '@/lib/server/auth-cookies';

function encodePendingGithubLink(value: { walletAddress: string; returnTo: string }) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const walletAddress = searchParams.get('wallet');
  const returnTo = searchParams.get('returnTo') || searchParams.get('redirect') || '/dashboard';
  const baseUrl = getBaseSiteUrl(req.url, req.headers.get('host'));

  if (!walletAddress) {
    return NextResponse.json({ error: 'wallet address required' }, { status: 400 });
  }

  try {
    if (!hasSupabaseEnv()) {
      return NextResponse.redirect(new URL('/dashboard?github=unavailable', baseUrl));
    }

    const supabase = await createServerSupabaseClient(req.headers.get('host'));
    
    const redirectUrl = new URL('/auth/callback', baseUrl);
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: redirectUrl.toString(),
        scopes: 'read:user user:email'
      }
    });

    if (error || !data.url) {
      console.error('Supabase OAuth error:', error);
      return NextResponse.redirect(new URL('/login?error=github_init_failed', baseUrl));
    }

    const response = NextResponse.redirect(data.url);
    response.cookies.set(
      REVERIE_GITHUB_LINK_COOKIE,
      encodePendingGithubLink({ walletAddress, returnTo }),
      githubLinkCookieOptions(req.headers.get('host'))
    );
    return response;
  } catch (err) {
    console.error('GitHub init error:', err);
    return NextResponse.redirect(new URL('/login?error=github_init_error', baseUrl));
  }
}
