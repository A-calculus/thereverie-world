import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'Live funding is wallet-signed. Transfer STT to the world contract through the SDK, then record the confirmed transaction through /api/apps/[worldId]/fund/complete.',
  }, { status: 410 });
}
