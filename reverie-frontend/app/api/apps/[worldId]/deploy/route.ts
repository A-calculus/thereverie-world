import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'Live deployment is wallet-signed. Use /api/apps/[worldId]/deploy/manifest, then record the confirmed SDK deployment through /api/apps/[worldId]/deploy/complete.',
  }, { status: 410 });
}
