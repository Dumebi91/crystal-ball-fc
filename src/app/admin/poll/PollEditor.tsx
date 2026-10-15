'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export function PollEditor({ date, saved }: { date: string; saved: { question: string; options: string[] } | null }) {
  const router = useRouter();
  const [question, setQuestion] = useState(saved?.question ?? '');
  const [options, setOptions] = useState<string[]>(saved?.options ?? ['', '', '']);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    const { error } = await supabaseBrowser().rpc('admin_save_poll', { p_date: date, p_question: question, p_options: opts });
    if (error) return setMsg({ ok: false, text: error.message.includes('poll_locked') ? 'People have voted, so this poll can no longer change.' : 'A poll needs a question and 2 to 4 answers.' });
    setMsg({ ok: true, text: 'Saved. It opens at 12pm.' });
    router.refresh();
  }

  return (
    <div className="card stack" style={{ maxWidth: 680 }}>
      <h1 className="display d-m">Poll of the Day</h1>
      <label className="row cap" style={{ gap: 8 }}>Date
        <input type="date" className="input" style={{ minHeight: 42, width: 'auto' }} value={date} onChange={(e) => e.target.value && router.push(`/admin/poll?date=${e.target.value}`)} />
      </label>
      <div className="field"><label htmlFor="pq">Question</label><input id="pq" className="input" value={question} onChange={(e) => setQuestion(e.target.value)} /></div>
      {options.map((o, i) => (
        <input key={i} className="input" placeholder={`Answer ${i + 1}${i >= 2 ? ' (optional)' : ''}`} value={o} aria-label={`Answer ${i + 1}`}
               onChange={(e) => setOptions(options.map((x, k) => (k === i ? e.target.value : x)))} />
      ))}
      {options.length < 4 && <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setOptions([...options, ''])}>Add an answer</button>}
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={save}>Save poll</button>
      {msg && <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>}
    </div>
  );
}
