import { NextRequest, NextResponse } from 'next/server';
import { demoTriggers } from '@/lib/shared/demo-data';
import { getServerSession } from '@/lib/server/session';

interface Params {
  params: Promise<{ triggerId: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { triggerId } = await params;
  const trigger = demoTriggers.find((item) => item.id === triggerId) ?? demoTriggers[0];
  return NextResponse.json({
    trigger,
    matched: true,
    preview: `${trigger.conditionLabel} matched and would invoke ${trigger.agentName}.`,
    source: 'demo',
  });
}
