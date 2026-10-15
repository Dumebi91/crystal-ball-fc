'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Reply = { id: number; user_id: string; side: string | null; body: string; hidden: boolean; created_at: string; handle: string };

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

export function DressingRoom({ takeId, me, replies }: { takeId: number; me: { id: string; handle: string } | null; replies: Reply[] }) {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [gone, setGone] = useState<number[]>([]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setMsg('');
    const { error } = await supabase.rpc('post_reply', { p_take: takeId, p_body: text });
    setBusy(false);
    if (error) return setMsg(error.message.includes('slow_mode') ? 'Slow mode: one reply every 30 seconds on each take.' : error.message.includes('too_long') ? 'Keep it to 280 characters.' : "Your reply didn't post. Try again.");
    setText('');
    router.refresh();
  }
  async function report(id: number) {
    const { error } = await supabase.rpc('report_reply', { p_reply: id, p_reason: 'reported by a member' });
    if (!error) { setGone([...gone, id]); setMsg('Reported. A Steward will review it.'); }
  }
  async function remove(id: number) {
    const { error } = await supabase.rpc('delete_reply', { p_reply: id });
    if (!error) setGone([...gone, id]);
  }

  const shown = replies.filter((r) => !gone.includes(r.id));
  return (
    <section className="stack" style={{ gap: 14, marginTop: 12 }}>
      <h2 className="display d-m">The Dressing Room</h2>
      {me ? (
        <form className="stack" style={{ gap: 10 }} onSubmit={post}>
          <label htmlFor="reply" className="flabel">Add your take</label>
          <textarea id="reply" className="input" maxLength={280} placeholder="Banter yes, abuse no." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="between">
            <span className="cap">{280 - text.length} characters left</span>
            <button className="btn secondary sm" disabled={busy || !text.trim()}>{busy ? 'Posting…' : 'Post reply'}</button>
          </div>
        </form>
      ) : (
        <div className="panel between"><span>Join to reply.</span><Link href="/login" className="btn primary sm">Join free</Link></div>
      )}
      {msg && <p className="cap" role="status">{msg}</p>}
      <div className="card" style={{ padding: '4px 20px' }}>
        {shown.length === 0 && <p className="muted" style={{ padding: '16px 0' }}>No replies yet. Go first.</p>}
        {shown.map((r) => (
          <div key={r.id} className="reply">
            <span className="avatar" style={{ width: 36, height: 36, fontSize: 12, borderColor: 'var(--line-strong)' }}>{r.handle.slice(0, 2).toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14 }}>@{r.handle}</b>
                {r.side && <span className={`side ${r.side}`}>{r.side === 'agree' ? 'Agrees' : 'Disagrees'}</span>}
                <span className="cap">{ago(r.created_at)}</span>
              </div>
              {r.hidden ? (
                <p className="cap" style={{ marginTop: 6 }}>Only you can see this while a Steward reviews a report: {r.body}</p>
              ) : (
                <p style={{ fontSize: 15, marginTop: 6, overflowWrap: 'anywhere' }}>{r.body}</p>
              )}
              {me && (
                <div className="row cap" style={{ gap: 16, marginTop: 4 }}>
                  {r.user_id === me.id
                    ? <button className="linkbtn" style={{ fontSize: 13, minHeight: 28, padding: 0, color: 'var(--muted)' }} onClick={() => remove(r.id)}>Delete</button>
                    : <button className="linkbtn" style={{ fontSize: 13, minHeight: 28, padding: 0, color: 'var(--muted)' }} onClick={() => report(r.id)}>Report</button>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
