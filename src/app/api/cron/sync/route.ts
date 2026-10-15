import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Runs every 10 minutes (vercel.json). Pulls Premier League and international fixtures and results, scores finished games,
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

  async function pull(league: string, season: string): Promise<any[]> {
    const url = `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}&from=${from}&to=${to}&timezone=UTC`;
    const res = await fetch(url, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY! }, cache: 'no-store' });
    if (!res.ok) throw new Error(`provider ${res.status} for league ${league}`);
    return (await res.json()).response ?? [];
  }

  const toFixture = (r: any, competition: 'PL' | 'INT') => {
    const status = STATUS[r.fixture.status.short] ?? 'NS';
    const round = String(r.league.round ?? '').match(/(\d+)$/);
    const month = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(r.fixture.date));
    return {
      id: r.fixture.id,
      competition,
      season_id: process.env.SEASON_ID,
      // Premier League games group by round; internationals group by the month of the break.
      matchweek: competition === 'PL' ? (round ? `Matchweek ${round[1]}` : String(r.league.round)) : `Internationals · ${month}`,
      home: r.teams.home.name,
      away: r.teams.away.name,
      kickoff_at: r.fixture.date,
      status,
      home_goals: status === 'FT' ? r.score.fulltime.home : null,
      away_goals: status === 'FT' ? r.score.fulltime.away : null,
    };
  };

  let fixtures: ReturnType<typeof toFixture>[];
  try {
    const pl = await pull(process.env.API_FOOTBALL_LEAGUE_ID!, process.env.API_FOOTBALL_SEASON!);
    fixtures = pl.map((r) => toFixture(r, 'PL'));
    // International competitions (friendlies, qualifiers, Nations League...). Which games are playable is decided
    // in the database: Super Eagles games always, top-20 v top-20 automatically, the rest by an editor.
    const intLeagues = (process.env.API_FOOTBALL_INT_LEAGUES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const intSeason = process.env.API_FOOTBALL_INT_SEASON || String(now.getUTCFullYear());
    for (const league of intLeagues) {
      fixtures.push(...(await pull(league, intSeason)).map((r) => toFixture(r, 'INT')));
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

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
