import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { withSharedCookieDomain } from '@/lib/server/auth-cookies';

/**
 * Creates a Supabase client for use in Next.js Server Components and API Routes.
 * Uses httpOnly cookies for session management (secure by default in Next.js).
 */
export async function createServerSupabaseClient(host?: string | null) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('Supabase public environment variables are not configured.');
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, withSharedCookieDomain(options, host))
            );
          } catch {
            // In Server Components, cookies can't be set — safe to ignore here
            // as middleware handles session refresh
          }
        },
      },
    }
  );
}

/**
 * Creates a Supabase Admin client using the service_role key.
 * ONLY use server-side. Never expose the service role key to the browser.
 */
export function createAdminSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin environment variables are not configured.');
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
