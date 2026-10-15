import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Runs every 10 minutes (vercel.json). Pulls fixtures and results, scores finished games,
// sets each matchweek's crowning time and crowns any Oracle of the Week that's due.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// API-Football status codes → ours. Final scores use score.fulltime (end of normal time).
const STATUS: Record<string, string> = {
  TBD: 'NS', NS: 'NS',
  '1H': 'LIVE', HT: 'LIVE', '2H': 'LIVE', ET: 'LIVE', BT: 'LIVE', P: 'LIVE', SUSP: 'LIVE', INT: 'LIVE', LIVE: 'LIVE',
  FT: 'FT', AET: 'FT', PEN: 'FT',
  PST: 'PST', CANC: 'CANC', ABD: 'ABD', AWD: 'ABD', WO: 'ABD',
};

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const now = new Date();
  const from = ymd(new Date(now.getTime() - 4 * 86400000));
  const to = ymd(new Date(now.getTime() + 14 * 86400000));
  const url = `https://v3.football.api-sports.io/fixtures?league=${process.env.API_FOOTBALL_LEAGUE_ID}&season=${process.env.API_FOOTBALL_SEASON}&from=${from}&to=${to}&timezone=UTC`;
  const res = await fetch(url, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY! }, cache: 'no-store' });
  if (!res.ok) return NextResponse.json({ error: `provider ${res.status}` }, { status: 502 });
  const body = await res.json();

  const fixtures = (body.response ?? []).map((r: any) => {
    const status = STATUS[r.fixture.status.short] ?? 'NS';
    const round = String(r.league.round ?? '').match(/(\d+)$/);
    return {
      id: r.fixture.id,
      competition: 'PL',
      season_id: process.env.SEASON_ID,
      matchweek: round ? `Matchweek ${round[1]}` : String(r.league.round),
      home: r.teams.home.name,
      away: r.teams.away.name,
      kickoff_at: r.fixture.date,
      status,
      home_goals: status === 'FT' ? r.score.fulltime.home : null,
      away_goals: status === 'FT' ? r.score.fulltime.away : null,
    };
  });

  const db = supabaseAdmin();
  const steps: Record<string, unknown> = { fetched: fixtures.length };
  for (const [name, args] of [
    ['upsert_fixtures', { p: fixtures }],
    ['refresh_matchweek_windows', {}],
    ['score_pending', {}],
    ['crown_due', {}],
  ] as const) {
    const { data, error } = await db.rpc(name, args);
    if (error) return NextResponse.json({ ...steps, failed: name, error: error.message }, { status: 500 });
    steps[name] = data;
  }
  return NextResponse.json(steps);
}
