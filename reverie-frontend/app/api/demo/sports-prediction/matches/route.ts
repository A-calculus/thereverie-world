import { NextRequest, NextResponse } from 'next/server';

const matches = {
  'arsenal-chelsea-demo': {
    id: 'arsenal-chelsea-demo',
    league: 'Premier League',
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    kickoffUtc: '2026-06-08T19:00:00.000Z',
    status: 'complete',
    form: {
      home: ['W', 'W', 'D', 'W', 'L'],
      away: ['D', 'L', 'W', 'D', 'W'],
    },
    predictionBaseline: {
      favorite: 'Arsenal',
      confidence: 0.62,
      reason: 'Recent home form and defensive stability.',
    },
    finalScore: { home: 2, away: 1 },
  },
  'lakers-celtics-demo': {
    id: 'lakers-celtics-demo',
    league: 'NBA',
    homeTeam: 'Lakers',
    awayTeam: 'Celtics',
    kickoffUtc: '2026-06-08T02:30:00.000Z',
    status: 'complete',
    form: {
      home: ['W', 'L', 'W', 'W', 'L'],
      away: ['W', 'W', 'W', 'L', 'W'],
    },
    predictionBaseline: {
      favorite: 'Celtics',
      confidence: 0.58,
      reason: 'Better recent efficiency and bench scoring.',
    },
    finalScore: { home: 104, away: 111 },
  },
  'chiefs-ravens-demo': {
    id: 'chiefs-ravens-demo',
    league: 'NFL',
    homeTeam: 'Chiefs',
    awayTeam: 'Ravens',
    kickoffUtc: '2026-06-08T21:25:00.000Z',
    status: 'scheduled',
    form: {
      home: ['W', 'W', 'L', 'W', 'W'],
      away: ['W', 'L', 'W', 'W', 'D'],
    },
    predictionBaseline: {
      favorite: 'Chiefs',
      confidence: 0.54,
      reason: 'Home-field edge and late-game execution.',
    },
    finalScore: null,
  },
};

export async function GET(req: NextRequest) {
  const matchId = req.nextUrl.searchParams.get('matchId') ?? 'arsenal-chelsea-demo';
  const match = matches[matchId as keyof typeof matches] ?? matches['arsenal-chelsea-demo'];
  return NextResponse.json({
    source: 'prepared-demo',
    match,
    generatedAt: new Date().toISOString(),
  });
}
