import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server/session';
import { nativeAgentPrimitives, type NativeAgentKind } from '@/lib/shared/native-agent-methods';

export const runtime = 'nodejs';

type AgentTestBody = {
  kind?: NativeAgentKind;
  config?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as AgentTestBody | null;
  if (!body?.kind || !nativeAgentPrimitives[body.kind] || !body.config) {
    return NextResponse.json({ error: 'kind and config are required' }, { status: 400 });
  }

  return NextResponse.json({
    error: 'Native agent execution is browser-wallet only. Use the /agents/create live test flow so the connected wallet signs the SDK transaction.',
    mode: 'wallet-required',
    costEstimate: nativeAgentPrimitives[body.kind].deposit,
  }, { status: 400 });
}
