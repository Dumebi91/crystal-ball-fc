'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { friendly } from '@/lib/errors';
import { kickoffLabel } from '@/lib/time';
import { Icon } from '@/components/Icon';

type Fixture = { id: number; competition: string; home: string; away: string; kickoff_at: string; status: string; home_goals: number | null; away_goals: number | null };
type Call = { fixture_id: number; home_goals: number; away_goals: number };

export function CallList({ fixtures, calls }: { fixtures: Fixture[]; calls: Call[] }) {
  if (fixtures.length === 0) return <div className="card"><p className="muted">No games to call right now. Check back when the next matchweek opens.</p></div>;
  return (
    <div className="grid2">
      {fixtures.map((f) => <CallCard key={f.id} f={f} saved={calls.find((c) => c.fixture_id === f.id)} />)}
    </div>
  );
}

function CallCard({ f, saved }: { f: Fixture; saved?: Call }) {
  const locked = f.status !== 'NS' || Date.now() >= Date.parse(f.kickoff_at);
  const [h, setH] = useState(saved?.home_goals ?? 0);
  const [a, setA] = useState(saved?.away_goals ?? 0);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(saved ? 'saved' : 'idle');
  const [msg, setMsg] = useState('');
  const [split, setSplit] = useState<{ calls: number; home?: number; draw?: number; away?: number } | null>(null);
  const supabase = supabaseBrowser();

  async function save() {
    setState('saving');
    const { error } = await supabase.rpc('save_call', { p_fixture: f.id, p_home: h, p_away: a });
    if (error) { setState('error'); setMsg(friendly(error.message)); return; }
    setState('saved');
    const { data } = await supabase.rpc('crowd_split', { p_fixture: f.id });
    setSplit(data);
  }

  const Stepper = ({ v, set, label }: { v: number; set: (n: number) => void; label: string }) => (
    <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
      <span className="score" aria-label={`${label} goals`}>{v}</span>
      {!locked && (
        <div className="row" style={{ gap: 6 }}>
          <button className="step" aria-label={`Fewer ${label} goals`} onClick={() => { set(Math.max(0, v - 1)); setState('idle'); }}>−</button>
          <button className="step" aria-label={`More ${label} goals`} onClick={() => { set(Math.min(15, v + 1)); setState('idle'); }}>+</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="between">
        <span className="cap">{kickoffLabel(f.kickoff_at)}</span>
        {f.status === 'FT' ? <span className="chip">FT {f.home_goals}–{f.away_goals}</span>
          : locked ? <span className="chip"><Icon name="lock" size={13} />Locked</span>
          : state === 'saved' ? <span className="chip gold">Your call is in</span>
          : <span className="chip gold">Open</span>}
      </div>
      <div className="fixrow">
        <b style={{ textAlign: 'right' }}>{f.home}</b>
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Stepper v={h} set={setH} label={f.home} /><span className="muted" style={{ marginTop: 14 }}>–</span><Stepper v={a} set={setA} label={f.away} />
        </div>
        <b>{f.away}</b>
      </div>
      {!locked && state !== 'saved' && (
        <button className="btn primary sm" onClick={save} disabled={state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Lock in my call'}</button>
      )}
      {locked && !saved && <p className="cap">You didn't call this one.</p>}
      {state === 'error' && <p className="err" role="alert">{msg}</p>}
      {split && split.calls > 0 && <p className="cap">Crowd: {split.home}% home · {split.draw}% draw · {split.away}% away</p>}
    </div>
  );
}
