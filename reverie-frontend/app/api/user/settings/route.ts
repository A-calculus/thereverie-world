import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server/session';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { ensureSupabaseUser, hasSupabaseAdminEnv } from '@/lib/server/supabase';

export async function PUT(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();

  if (hasSupabaseAdminEnv()) {
    const userId = await ensureSupabaseUser(session);
    if (userId) {
      const supabase = createAdminSupabaseClient();
      const { data, error } = await supabase
        .from('users')
        .update({
          bio: body.bio ?? null,
          is_public_profile: body.isPublicProfile ?? false,
          email_notifications: body.emailNotifications ?? true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('id,wallet_address,bio,is_public_profile,email_notifications')
        .single();

      if (!error && data) {
        return NextResponse.json({
          user: {
            id: data.id,
            walletAddress: data.wallet_address,
            bio: data.bio,
            isPublicProfile: data.is_public_profile,
            emailNotifications: data.email_notifications,
          },
          source: 'supabase',
        });
      }
    }
  }

  return NextResponse.json({
    user: {
      id: session.userId,
      walletAddress: session.walletAddress,
      bio: body.bio ?? null,
      isPublicProfile: body.isPublicProfile ?? false,
      emailNotifications: body.emailNotifications ?? true,
    },
    source: 'demo',
  });
}
