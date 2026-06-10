import { NextRequest, NextResponse } from 'next/server';
import { buildCargoRoutePlan, projectCargoProgress } from '@/lib/shared/cargo-climate/engine';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const startPortId = searchParams.get('startPortId') ?? 'shanghai';
  const destinationPortId = searchParams.get('destinationPortId') ?? 'rotterdam';
  const speedKnots = Number(searchParams.get('speedKnots') ?? '18');
  const hours = Number(searchParams.get('hours') ?? '2');
  const distanceTravelledNm = Number(searchParams.get('distanceTravelledNm') ?? '0');

  try {
    const routePlan = buildCargoRoutePlan({
      startPortId,
      destinationPortId,
      speedKnots: Number.isFinite(speedKnots) && speedKnots > 0 ? speedKnots : 18,
      includeAlternatives: true,
    });
    const progress = projectCargoProgress(routePlan, {
      hoursAhead: Number.isFinite(hours) && hours >= 0 ? hours : 2,
      distanceTravelledNm: Number.isFinite(distanceTravelledNm) && distanceTravelledNm > 0 ? distanceTravelledNm : 0,
    });
    return NextResponse.json({ progress, routePlan, source: 'static-json' });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to project cargo progress',
    }, { status: 400 });
  }
}
