import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server/session';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (hasSupabaseAdminEnv()) {
    const supabase = createAdminSupabaseClient();
    const { data } = await supabase
      .from('users')
      .select('id,wallet_address,github_id,github_username,full_name,profile_pic_url,email,bio,is_public_profile,email_notifications')
      .eq('wallet_address', session.walletAddress)
      .maybeSingle();

    if (data) {
      return NextResponse.json({
        user: {
          id: data.id,
          walletAddress: data.wallet_address,
          githubId: data.github_id,
          githubUsername: data.github_username,
          fullName: data.full_name,
          profilePicUrl: data.profile_pic_url,
          email: data.email,
          bio: data.bio,
          isPublicProfile: data.is_public_profile,
          emailNotifications: data.email_notifications,
        },
        source: 'supabase',
      });
    }
  }

  return NextResponse.json({
    user: {
      id: session.userId,
      walletAddress: session.walletAddress,
      githubId: null,
      githubUsername: null,
      fullName: null,
      profilePicUrl: null,
      email: null,
      bio: null,
      isPublicProfile: false,
      emailNotifications: true,
    },
    source: 'session',
  });
}
