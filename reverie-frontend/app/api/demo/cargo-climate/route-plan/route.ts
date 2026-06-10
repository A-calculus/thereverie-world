import { NextRequest, NextResponse } from 'next/server';
import { buildCargoRoutePlan } from '@/lib/shared/cargo-climate/engine';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const startPortId = searchParams.get('startPortId') ?? 'shanghai';
  const destinationPortId = searchParams.get('destinationPortId') ?? 'rotterdam';
  const speedKnots = Number(searchParams.get('speedKnots') ?? '18');
  const includeAlternatives = searchParams.get('alternatives') !== 'false';

  try {
    const routePlan = buildCargoRoutePlan({
      startPortId,
      destinationPortId,
      speedKnots: Number.isFinite(speedKnots) && speedKnots > 0 ? speedKnots : 18,
      includeAlternatives,
    });
    return NextResponse.json({ routePlan, source: 'static-json' });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to build route plan',
    }, { status: 400 });
  }
}
