import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';

export async function POST() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (hasSupabaseAdminEnv()) {
    const supabase = createAdminSupabaseClient();
    const { error } = await supabase
      .from('users')
      .update({
        github_id: null,
        github_username: null,
        full_name: null,
        profile_pic_url: null,
        email: null,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', session.walletAddress);

    if (error) {
      console.error('GitHub disconnect error:', error);
      return NextResponse.json({ error: 'Failed to disconnect GitHub' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
