import { cookies } from 'next/headers';
import { REVERIE_SESSION_COOKIE } from '@/lib/server/auth-cookies';

export interface ReverieSession {
  walletAddress: string;
  userId: string;
  iat?: number;
}

export function parseSessionToken(sessionToken: string | undefined): ReverieSession | null {
  if (!sessionToken) return null;

  try {
    const data = JSON.parse(Buffer.from(sessionToken, 'base64').toString()) as Partial<ReverieSession>;
    if (!data.walletAddress) return null;
    return {
      walletAddress: data.walletAddress.toLowerCase(),
      userId: data.userId ?? data.walletAddress.toLowerCase(),
      iat: data.iat,
    };
  } catch {
    return null;
  }
}

export async function getServerSession(): Promise<ReverieSession | null> {
  const cookieStore = await cookies();
  return parseSessionToken(cookieStore.get(REVERIE_SESSION_COOKIE)?.value);
}

export function createSessionToken(session: ReverieSession): string {
  return Buffer.from(JSON.stringify(session)).toString('base64');
}
