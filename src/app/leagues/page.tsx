import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getMe } from '@/lib/session';
import { LeagueForms } from './LeagueForms';

export const metadata: Metadata = { title: 'Leagues' };
export const dynamic = 'force-dynamic';

export default async function LeaguesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { me } = await getMe();
  const supabase = await supabaseServer();
  const { id } = await searchParams;
  const { data: leagues } = await supabase.from('leagues').select('id, name, kind, invite_code, owner_id').order('created_at');
  const open = leagues?.find((l) => l.id === id) ?? leagues?.[0];
  const { data: table } = open ? await supabase.rpc('league_table', { p_league: open.id }) : { data: null };

  return (
    <div className="wrap page">
      <div className="pagehead">
        <p className="eyebrow">Play with your people</p>
        <h1 className="display d-l">Your leagues</h1>
        <p className="muted" style={{ maxWidth: '40em' }}>Everyone plays the same daily games. A league shows your crew's points side by side and crowns its own League Oracle every week.</p>
      </div>
      <div className="cols">
        <div className="main">
          {(leagues ?? []).length > 0 && (
            <div className="pills" role="tablist" aria-label="Your leagues">
              {leagues!.map((l) => (
                <Link key={l.id} href={`/leagues?id=${l.id}`} className="pill" role="tab" aria-selected={l.id === open?.id} aria-pressed={l.id === open?.id}
                      style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{l.name}</Link>
              ))}
            </div>
          )}
          {open ? (
            <div className="card" style={{ padding: '6px 16px' }}>
              <div className="between" style={{ padding: '14px 0 6px' }}>
                <p className="display d-s">{open.name}</p>
                <span className="cap">Invite code <b style={{ color: 'var(--ink)', letterSpacing: '.1em' }}>{open.invite_code}</b></span>
              </div>
              <table className="t">
                <thead><tr><th>#</th><th>Member</th><th className="r">This week</th></tr></thead>
                <tbody>
                  {(table ?? []).map((r: any) => (
                    <tr key={r.user_id} className={r.user_id === me?.id ? 'me' : undefined}>
                      <td className="muted" style={{ fontWeight: 700 }}>{r.pos}</td><td style={{ fontWeight: 600 }}>@{r.handle}</td><td className="r num" style={{ fontWeight: 700 }}>{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card"><p className="muted">You're not in a league yet. Start one for your office, your friends or your fan club, or join with a code.</p></div>
          )}
        </div>
        <aside className="rail"><LeagueForms /></aside>
      </div>
    </div>
  );
}
