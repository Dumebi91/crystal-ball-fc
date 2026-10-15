'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { kickoffLabel } from '@/lib/time';

type Fx = { id: number; home: string; away: string; kickoff_at: string; status: string; featured: boolean; calls: number; home_rank: number | null; away_rank: number | null };

export function IntPicker({ fixtures, ranks }: { fixtures: Fx[]; ranks: { name: string; fifa_rank: number }[] }) {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [list, setList] = useState(ranks.map((r) => r.name).join('\n'));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const featured = fixtures.filter((f) => f.featured).length;

  async function saveRanks() {
    // Accepts "1 Argentina", "1. Argentina" or just "Argentina", one per line, top first.
    const names = list.split('\n').map((l) => l.replace(/^\s*\d+[.)]?\s*/, '').trim()).filter(Boolean);
    const { data, error } = await supabase.rpc('admin_set_top_nations', { p_names: names });
    setMsg(error ? { ok: false, text: 'Saving the ranking failed. Use one country per line, 50 at most.' } : { ok: true, text: `Saved ${data} nations. New fixtures are picked using this list.` });
    router.refresh();
  }
  async function toggle(f: Fx) {
    const { error } = await supabase.rpc('admin_feature_fixture', { p_fixture: f.id, p_featured: !f.featured });
    setMsg(error ? { ok: false, text: error.message.includes('has_calls') ? `${f.home} v ${f.away} already has calls, so it stays on.` : 'That failed. Try again.' } : null);
    router.refresh();
  }
  const rank = (r: number | null) => (r ? <span className="cap"> ({r})</span> : null);

  return (
    <div className="cols">
      <div className="main">
        <div className="between"><h1 className="display d-m">Call It International</h1>
          <span className={featured >= 6 && featured <= 8 ? 'ok' : 'warn'}>{featured} games on · aim for 6 to 8 a break</span></div>
        <p className="cap">Super Eagles games are always on. Games between two top-20 nations switch on by themselves. Switch on a game with a top-10 side to reach 6 to 8. A game can't be switched off once members have called it.</p>
        <div className="card" style={{ padding: '6px 16px' }}>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Kick-off</th><th>Game</th><th className="r">Calls</th><th className="r">Playable</th></tr></thead>
              <tbody>
                {fixtures.map((f) => (
                  <tr key={f.id}>
                    <td className="cap">{kickoffLabel(f.kickoff_at)}</td>
                    <td style={{ fontWeight: f.featured ? 600 : 400 }}>{f.home}{rank(f.home_rank)} v {f.away}{rank(f.away_rank)}</td>
                    <td className="r num">{f.calls}</td>
                    <td className="r"><button className="switch" aria-pressed={f.featured} aria-label={`${f.home} v ${f.away} playable`} onClick={() => toggle(f)} /></td>
                  </tr>
                ))}
                {fixtures.length === 0 && <tr><td colSpan={4} className="muted">No international fixtures in the next 45 days yet. They arrive with the sync once the competitions are set up.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        {msg && <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>}
      </div>
      <aside className="rail">
        <div className="card stack">
          <p className="eyebrow">FIFA ranking (top 20 to 50)</p>
          <p className="cap">Paste from FIFA's men's world ranking, top first, one country per line. Spell names the way the fixtures list does (e.g. Ivory Coast, USA).</p>
          <textarea className="input" rows={14} value={list} onChange={(e) => setList(e.target.value)} aria-label="Ranking list" />
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={saveRanks}>Save ranking</button>
        </div>
      </aside>
    </div>
  );
}
