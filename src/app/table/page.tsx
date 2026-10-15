import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { currentMatchweek } from '@/lib/matchweek';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'The Table' };
export const dynamic = 'force-dynamic';

const RANK = (p: number) => (p >= 1200 ? 'Oracle' : p >= 500 ? 'Seer' : p >= 150 ? 'Reader' : 'Apprentice');

export default async function TablePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === 'season' ? 'season' : 'week';
  const supabase = await supabaseServer();
  const { me } = await getMe();
  const mw = await currentMatchweek();

  const { data: rows } = view === 'week'
    ? await supabase.from('weekly_scores').select('user_id, points').eq('matchweek_id', mw?.id ?? -1).order('points', { ascending: false }).limit(50)
    : await supabase.from('season_scores').select('user_id, points').eq('season_id', mw?.season_id ?? '').order('points', { ascending: false }).limit(50);
  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: people } = await supabase.from('profiles').select('id, handle, city').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const who = new Map((people ?? []).map((p) => [p.id, p]));

  return (
    <div className="wrap page">
      <div className="between" style={{ alignItems: 'flex-end', marginBottom: 24 }}>
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">{view === 'week' ? `${mw?.label ?? 'This week'} so far` : 'Season 2026/27'}</p>
          <h1 className="display d-l">The Table</h1>
        </div>
        <div className="seg" role="tablist" aria-label="Table">
          <Link role="tab" href="/table" aria-selected={view === 'week'} className="pill" style={{ border: 0 }}>This week</Link>
          <Link role="tab" href="/table?view=season" aria-selected={view === 'season'} className="pill" style={{ border: 0 }}>Season</Link>
        </div>
      </div>
      <div className="card" style={{ padding: '6px 16px' }}>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>#</th><th>Member</th><th>City</th>{view === 'season' && <th>Rank</th>}<th className="r">Points</th></tr></thead>
            <tbody>
              {(rows ?? []).map((r, i) => {
                const p = who.get(r.user_id);
                return (
                  <tr key={r.user_id} className={me?.id === r.user_id ? 'me' : undefined}>
                    <td className={i < 3 ? 'gold' : 'muted'} style={{ fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>@{p?.handle ?? 'former member'}</td>
                    <td className="muted">{p?.city ?? ''}</td>
                    {view === 'season' && <td>{RANK(r.points)}</td>}
                    <td className="r num" style={{ fontWeight: 700 }}>{r.points.toLocaleString('en-GB')}</td>
                  </tr>
                );
              })}
              {(rows ?? []).length === 0 && <tr><td colSpan={5} className="muted">No points yet. Be first on the table.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
