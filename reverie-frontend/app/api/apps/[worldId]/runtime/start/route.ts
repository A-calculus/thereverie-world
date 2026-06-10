import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'World arming is wallet-signed. Call WorldInstance.armWorld() in the browser SDK, then record the confirmed transaction through /api/apps/[worldId]/runtime/arm/complete.',
  }, { status: 410 });
}
