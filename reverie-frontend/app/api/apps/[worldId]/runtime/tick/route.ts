import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'Autonomous runtime ticks are owned by Somnia on-chain Reactivity. Use /api/apps/[worldId]/runtime/live for indexed state and /api/apps/[worldId]/runtime/manual-trigger/complete after a wallet-signed manual trigger.',
  }, { status: 410 });
}
