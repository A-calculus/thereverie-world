import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const errors: string[] = [];
  if (!body.name) errors.push('Template name is required.');
  if (!body.description) errors.push('Template description is required.');

  return NextResponse.json({
    valid: errors.length === 0,
    errors,
    estimate: {
      agents: body.agents?.length ?? 0,
      triggers: body.triggers?.length ?? 0,
    },
  });
}
