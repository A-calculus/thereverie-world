import { NextRequest, NextResponse } from 'next/server';
import { createWeatherSample } from '@/lib/shared/cargo-climate/engine';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const latitude = Number(searchParams.get('lat') ?? '0');
  const longitude = Number(searchParams.get('lon') ?? '0');
  const hourOffset = Number(searchParams.get('hourOffset') ?? '1');
  const sample = createWeatherSample({
    hourOffset: Number.isFinite(hourOffset) ? hourOffset : 1,
    latitude: Number.isFinite(latitude) ? latitude : 0,
    longitude: Number.isFinite(longitude) ? longitude : 0,
    distanceFromStartNm: 0,
    lane: 'public-demo-weather',
    zoneId: 'public-demo-weather',
  });

  return NextResponse.json(sample);
}
