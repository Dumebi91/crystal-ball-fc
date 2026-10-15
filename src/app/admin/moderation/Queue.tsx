'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Report = { reply_id: number; body: string; author: string; take: string; reports: number; reasons: string[]; created_at: string };
type Flag = { id: number; handle: string | null; kind: string; detail: any; created_at: string };

const FLAG_WORDS: Record<string, string> = {
  kb_too_fast: 'Answered a Know Ball question faster than anyone can read it',
  kb_perfect_fast: '10/10 on Know Ball in under 15 seconds',
};

export function Queue({ reports, flags }: { reports: Report[]; flags: Flag[] }) {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');

  async function decide(reply: number, keep: boolean) {
    const { error } = await supabase.rpc('review_report', { p_reply: reply, p_keep: keep });
    setMsg(error ? 'That failed. Try again.' : keep ? 'Reply restored.' : 'Reply removed.');
    router.refresh();
  }
  async function review(flag: number, outcome: 'cleared' | 'actioned') {
    if (!notes[flag]?.trim()) return setMsg('Add a short note on what you checked first.');
    const { error } = await supabase.rpc('admin_review_flag', { p_flag: flag, p_outcome: outcome, p_note: notes[flag] });
    setMsg(error ? 'That failed. Try again.' : outcome === 'cleared' ? 'Flag cleared.' : 'Flag actioned. An admin can correct points under Members.');
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 28 }}>
      {msg && <p className="ok" role="status">{msg}</p>}
      <section className="stack">
        <h1 className="display d-m">Reported replies ({reports.length})</h1>
        <p className="cap">Remove anything that breaks the house rules: attacks on people, politics, religion or tribe, hate, threats, betting tips, personal details or spam. Keep anything that's just a strong opinion.</p>
        {reports.length === 0 && <div className="card"><p className="muted">Nothing to review.</p></div>}
        {reports.map((r) => (
          <div key={r.reply_id} className="card stack" style={{ gap: 8 }}>
            <p className="cap">@{r.author} on "{r.take}" · {r.reports} report{r.reports === 1 ? '' : 's'}{r.reasons.length ? `: ${r.reasons.join(', ')}` : ''}</p>
            <p style={{ fontSize: 17 }}>{r.body}</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn ghost sm" onClick={() => decide(r.reply_id, true)}>Keep it</button>
              <button className="btn sm" style={{ background: 'var(--magenta)', color: 'var(--midnight)' }} onClick={() => decide(r.reply_id, false)}>Remove it</button>
            </div>
          </div>
        ))}
      </section>
      <section className="stack">
        <h2 className="display d-m">Fair-play flags ({flags.length})</h2>
        <p className="cap">A flag is a pattern for a person to look at, not proof. Check the member's other answers before deciding, and note what you found.</p>
        {flags.length === 0 && <div className="card"><p className="muted">Nothing to review.</p></div>}
        {flags.map((f) => (
          <div key={f.id} className="card stack" style={{ gap: 8 }}>
            <p><b>@{f.handle ?? 'former member'}</b> · {FLAG_WORDS[f.kind] ?? f.kind}</p>
            <p className="cap">
              {new Date(f.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })} WAT
              {f.detail?.index != null ? ` · question ${f.detail.index + 1}` : ''}
              {f.detail?.ms != null ? ` · ${f.kind === 'kb_too_fast' ? 'answered in' : 'total time'} ${(f.detail.ms / 1000).toFixed(1)}s` : ''}
            </p>
            <input className="input" placeholder="What you checked and why" value={notes[f.id] ?? ''} onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} aria-label="Review note" />
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn ghost sm" onClick={() => review(f.id, 'cleared')}>Clear: looks genuine</button>
              <button className="btn sm" style={{ background: 'var(--gold)', color: 'var(--midnight)' }} onClick={() => review(f.id, 'actioned')}>Action: cheating likely</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
