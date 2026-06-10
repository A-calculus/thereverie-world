import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'Manual world actions are wallet-signed. Call WorldInstance.fireManualTrigger() in the browser SDK, then record the confirmed transaction through /api/apps/[worldId]/runtime/manual-trigger/complete.',
  }, { status: 410 });
}
