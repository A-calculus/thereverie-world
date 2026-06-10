import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseAdminEnv, hasSupabaseEnv } from '@/lib/server/supabase';
import type { User } from '@supabase/supabase-js';
import {
  expiredGithubLinkCookieOptions,
  getBaseSiteUrl,
  REVERIE_GITHUB_LINK_COOKIE,
} from '@/lib/server/auth-cookies';

function decodePendingGithubLink(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    return {
      walletAddress: typeof record.walletAddress === 'string' ? record.walletAddress : null,
      returnTo: typeof record.returnTo === 'string' ? record.returnTo : '/dashboard',
    };
  } catch {
    return null;
  }
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exchangeGithubCode(code: string, host?: string | null): Promise<{ user: User | null; error: unknown }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const supabase = await createServerSupabaseClient(host);
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) return { user: data.user, error: null };
    lastError = error;

    const retryable =
      error &&
      typeof error === 'object' &&
      ('status' in error ? (error as { status?: number }).status === 0 : false);
    if (!retryable || attempt === 2) break;
    await wait(350);
  }

  return { user: null, error: lastError };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const pendingLink = decodePendingGithubLink(req.cookies.get(REVERIE_GITHUB_LINK_COOKIE)?.value);
  const walletAddress = searchParams.get('wallet') ?? pendingLink?.walletAddress;
  const returnTo = pendingLink?.returnTo || '/dashboard';
  const baseUrl = getBaseSiteUrl(req.url, req.headers.get('host'));

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', baseUrl));
  }
  if (!walletAddress) {
    return NextResponse.redirect(new URL('/login?error=no_wallet', baseUrl));
  }

  try {
    if (!hasSupabaseEnv()) {
      const response = NextResponse.redirect(new URL('/dashboard?github=unavailable', baseUrl));
      response.cookies.set(REVERIE_GITHUB_LINK_COOKIE, '', expiredGithubLinkCookieOptions(req.headers.get('host')));
      return response;
    }

    const { user, error: authError } = await exchangeGithubCode(code, req.headers.get('host'));

    if (authError || !user) {
      console.error('Supabase auth error:', authError);
      return NextResponse.redirect(new URL('/login?error=github_token_failed', baseUrl));
    }

    // Auth user contains GitHub info in user_metadata
    const githubId = user.user_metadata.provider_id;
    const githubUsername = user.user_metadata.user_name || user.user_metadata.preferred_username;
    const fullName = user.user_metadata.full_name || user.user_metadata.name;
    const profilePicUrl = user.user_metadata.avatar_url;
    const email = user.email;

    // Link GitHub profile to wallet user in our custom `users` table
    if (hasSupabaseAdminEnv()) {
      const adminSupabase = createAdminSupabaseClient();
      await adminSupabase
        .from('users')
        .upsert({
          wallet_address: walletAddress.toLowerCase(),
          github_id: String(githubId),
          github_username: githubUsername,
          full_name: fullName,
          profile_pic_url: profilePicUrl,
          email,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'wallet_address', ignoreDuplicates: false });
    }

    const target = new URL(returnTo.startsWith('/') ? returnTo : '/dashboard', baseUrl);
    target.searchParams.set('github', 'linked');
    const response = NextResponse.redirect(target);
    response.cookies.set(REVERIE_GITHUB_LINK_COOKIE, '', expiredGithubLinkCookieOptions(req.headers.get('host')));
    return response;
  } catch (err) {
    console.error('GitHub callback error:', err);
    return NextResponse.redirect(new URL('/login?error=github_callback_failed', baseUrl));
  }
}
