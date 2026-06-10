import { NextRequest, NextResponse } from 'next/server';
import { expiredSessionCookieOptions, REVERIE_SESSION_COOKIE } from '@/lib/server/auth-cookies';

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(REVERIE_SESSION_COOKIE, '', expiredSessionCookieOptions(req.headers.get('host')));
  response.headers.append(
    'Set-Cookie',
    `${REVERIE_SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
  );
  return response;
}
