import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server/session';

function readJsonPath(value: unknown, selector: string | undefined): unknown {
  if (!selector) return value;
  return selector.split('.').filter(Boolean).reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)];
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();

  if (typeof body.url === 'string' && body.url.trim()) {
    let targetUrl: URL;
    try {
      targetUrl = new URL(body.url);
    } catch {
      return NextResponse.json({ error: 'Public API URL is invalid.' }, { status: 400 });
    }
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return NextResponse.json({ error: 'Public API URL must use http or https.' }, { status: 400 });
    }

    const method = String(body.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
    const init: RequestInit = {
      method,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    };
    if (method === 'POST') {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = typeof body.requestBody === 'string' ? body.requestBody : JSON.stringify(body.requestBody ?? {});
    }

    try {
      const response = await fetch(targetUrl.toString(), init);
      const contentType = response.headers.get('content-type') ?? '';
      const sample = contentType.includes('application/json') ? await response.json() : await response.text();
      if (!response.ok) {
        return NextResponse.json({ error: `Public API returned ${response.status}`, sample, source: 'live' }, { status: 400 });
      }
      const value = readJsonPath(sample, typeof body.selector === 'string' ? body.selector : undefined);
      if (value === undefined) {
        return NextResponse.json({ error: `Selector "${body.selector}" did not match any value in the JSON response.`, sample, source: 'live' }, { status: 400 });
      }
      return NextResponse.json({
        feedType: body.feedType ?? 'json',
        url: targetUrl.toString(),
        selector: body.selector ?? '',
        value,
        sample,
        source: 'live',
      });
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Public API preview failed.',
        source: 'live',
      }, { status: 400 });
    }
  }

  return NextResponse.json({
    feedType: body.feedType ?? 'weather',
    sample: {
      temperature: 8.7,
      volatility: 9.2,
      fetchedAt: '2026-06-02T10:00:00.000Z',
    },
    source: 'demo',
  });
}
