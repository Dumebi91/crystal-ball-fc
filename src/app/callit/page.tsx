import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase/server';
import { currentMatchweek } from '@/lib/matchweek';
import { CallList } from './CallList';

export const metadata: Metadata = { title: 'Call It' };
export const dynamic = 'force-dynamic';

export default async function CallItPage() {
  const supabase = await supabaseServer();
  const mw = await currentMatchweek();
  const { data: fixtures } = mw
    ? await supabase.from('fixtures').select('id, competition, home, away, kickoff_at, status, home_goals, away_goals')
        .eq('matchweek_id', mw.id).order('kickoff_at')
    : { data: [] };
  const { data: calls } = await supabase.from('calls').select('fixture_id, home_goals, away_goals')
    .in('fixture_id', (fixtures ?? []).map((f) => f.id));

  return (
    <div className="wrap page">
      <div className="pagehead">
        <p className="eyebrow">{mw?.label ?? 'No games scheduled'}</p>
        <h1 className="display d-l">Call the weekend</h1>
        <p className="muted">10 points for the exact score, 3 for the right result. Each game locks at its kick-off.</p>
      </div>
      <CallList fixtures={fixtures ?? []} calls={calls ?? []} />
    </div>
  );
}
