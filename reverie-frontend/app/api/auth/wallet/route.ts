import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { createSessionToken } from '@/lib/server/session';
import { expiredSessionCookieOptions, REVERIE_SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/auth-cookies';

export async function POST(req: NextRequest) {
  try {
    const { address, signature, message } = await req.json();

    if (!address || !signature || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let userId = address.toLowerCase();
    let profile: {
      githubId?: string | null;
      githubUsername?: string | null;
      fullName?: string | null;
      profilePicUrl?: string | null;
      email?: string | null;
    } = {};

    if (hasSupabaseAdminEnv()) {
      const supabase = createAdminSupabaseClient();
      const { data: user, error } = await supabase
        .from('users')
        .upsert(
          {
            wallet_address: address.toLowerCase(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'wallet_address', ignoreDuplicates: false }
        )
        .select('id,github_id,github_username,full_name,profile_pic_url,email')
        .single();

      if (error) {
        console.error('Supabase upsert error:', error);
      } else if (user?.id) {
        userId = user.id;
        profile = {
          githubId: user.github_id,
          githubUsername: user.github_username,
          fullName: user.full_name,
          profilePicUrl: user.profile_pic_url,
          email: user.email,
        };
      }
    }

    const sessionToken = createSessionToken({
      walletAddress: address.toLowerCase(),
      userId,
      iat: Date.now(),
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: userId,
        walletAddress: address.toLowerCase(),
        ...profile,
      },
      hasGithubProfile: Boolean(profile.githubUsername || profile.email || profile.fullName || profile.profilePicUrl),
    });

    // Shared across canonical subdomains, but still httpOnly and unavailable to JS.
    response.cookies.set(REVERIE_SESSION_COOKIE, sessionToken, sessionCookieOptions(req.headers.get('host')));

    return response;
  } catch (err) {
    console.error('Wallet auth error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(REVERIE_SESSION_COOKIE, '', expiredSessionCookieOptions(req.headers.get('host')));
  response.headers.append(
    'Set-Cookie',
    `${REVERIE_SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
  );
  return response;
}
