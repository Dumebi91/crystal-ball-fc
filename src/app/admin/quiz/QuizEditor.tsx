'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Q = { slot: number; variant: number; difficulty: string; prompt: string; options: string[]; correct: number; fact: string };
type Saved = { is_prize: boolean; prize_start: string | null; locked: boolean; players: number; questions: Q[] } | null;

// 7 fixed slots and 3 swap slots (two versions each), as in the game formats deep dive.
const LAYOUT: [number, number][] = [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 1], [8, 2], [9, 1], [9, 2], [10, 1], [10, 2]];
const DEFAULT_LEVEL = (slot: number) => (slot <= 3 ? 'easy' : slot <= 6 ? 'medium' : slot <= 8 ? 'hard' : 'home');
const TARGET: Record<string, number> = { easy: 3, medium: 3, hard: 2, home: 2 };
const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['home', 'Home colours']];

function blank(slot: number, variant: number): Q {
  return { slot, variant, difficulty: DEFAULT_LEVEL(slot), prompt: '', options: ['', '', '', ''], correct: 0, fact: '' };
}

/**
 * Paste rows straight from a spreadsheet (tab-separated). Columns:
 * slot · version (0 for slots 1-7, 1 or 2 for slots 8-10) · difficulty · question · A · B · C · D · right answer (A-D) · fact
 * Header rows are skipped.
 */
function parseSheet(text: string): { rows: Q[]; problems: string[] } {
  const rows: Q[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const c = line.split('\t').map((s) => s.trim());
    if (c.length < 9 || !/^\d+$/.test(c[0])) { if (line.trim() && i > 0) problems.push(`Line ${i + 1} skipped`); return; }
    const level = c[2].toLowerCase().startsWith('home') ? 'home' : c[2].toLowerCase();
    const answer = 'ABCD'.indexOf(c[8].toUpperCase());
    if (!TARGET[level] || answer < 0) { problems.push(`Line ${i + 1}: check difficulty and right answer`); return; }
    rows.push({ slot: Number(c[0]), variant: Number(c[1]) || 0, difficulty: level, prompt: c[3], options: [c[4], c[5], c[6], c[7]], correct: answer, fact: c[9] ?? '' });
  });
  return { rows, problems };
}

export function QuizEditor({ date, saved }: { date: string; saved: Saved }) {
  const router = useRouter();
  const [qs, setQs] = useState<Q[]>(() =>
    LAYOUT.map(([s, v]) => saved?.questions.find((q) => q.slot === s && q.variant === v) ?? blank(s, v)));
  const [prize, setPrize] = useState(saved?.is_prize ?? false);
  const [prizeStart, setPrizeStart] = useState(saved?.prize_start ?? '09:00');
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = !!saved?.locked;

  const mix = useMemo(() => {
    const count: Record<string, number> = { easy: 0, medium: 0, hard: 0, home: 0 };
    for (let s = 1; s <= 10; s++) { const q = qs.find((x) => x.slot === s); if (q) count[q.difficulty]++; }
    return count;
  }, [qs]);
  const complete = qs.every((q) => q.prompt.trim() && q.options.every((o) => o.trim()));

  const set = (i: number, patch: Partial<Q>) => setQs((all) => all.map((q, k) => (k === i ? { ...q, ...patch } : q)));

  function applyPaste() {
    const { rows, problems } = parseSheet(paste);
    let placed = 0;
    setQs((all) => all.map((q) => {
      const r = rows.find((x) => x.slot === q.slot && x.variant === q.variant);
      if (r) { placed++; return r; }
      return q;
    }));
    setMsg({ ok: problems.length === 0, text: `Filled ${rows.length} question${rows.length === 1 ? '' : 's'} from the sheet.${problems.length ? ' ' + problems.join('. ') + '.' : ''}` });
    setPaste('');
  }

  async function save() {
    setBusy(true); setMsg(null);
    const { error } = await supabaseBrowser().rpc('admin_save_quiz', { p_date: date, p_questions: qs, p_is_prize: prize, p_prize_start: prizeStart });
    setBusy(false);
    if (error) {
      const m = error.message;
      const text = m.includes('quiz_locked') ? 'Someone has already played this quiz, so it can no longer be changed.'
        : m.includes('missing_slots') ? `Missing slots: ${m.split('missing_slots_')[1]}.`
        : m.includes('bad_question_in_slot') ? `Check slot ${m.split('bad_question_in_slot_')[1]}: every question needs text and four answers.`
        : 'Saving failed. Please try again.';
      return setMsg({ ok: false, text });
    }
    setMsg({ ok: true, text: 'Saved. It goes live at 9am.' });
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="display d-m">Know Ball</h1>
          <label className="row cap" style={{ gap: 8 }}>Date
            <input type="date" className="input" style={{ minHeight: 42, width: 'auto' }} value={date}
                   onChange={(e) => e.target.value && router.push(`/admin/quiz?date=${e.target.value}`)} />
          </label>
        </div>
        <div className="row cap" style={{ gap: 14, flexWrap: 'wrap' }}>
          {Object.entries(TARGET).map(([k, n]) => (
            <span key={k} className={mix[k] === n ? 'ok' : 'warn'}>{LEVELS.find((l) => l[0] === k)![1]} {mix[k]}/{n}</span>
          ))}
        </div>
      </div>

      {locked && <div className="panel"><b>Locked.</b> {saved?.players} member{saved?.players === 1 ? ' has' : 's have'} started this quiz, so it can't be changed.</div>}

      {!locked && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Paste from a spreadsheet</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <p className="cap">Copy the rows from your sheet and paste them here. Columns: slot · version (0 for slots 1–7, 1 or 2 for slots 8–10) · difficulty · question · A · B · C · D · right answer (A–D) · fact.</p>
            <textarea className="input" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Pasted rows" />
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={applyPaste} disabled={!paste.trim()}>Fill the questions</button>
          </div>
        </details>
      )}

      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        {qs.map((q, i) => (
          <div key={`${q.slot}-${q.variant}`} className="adm-q">
            <div className="between">
              <b>Slot {q.slot}{q.variant ? ` · version ${q.variant}` : ''}</b>
              <select className="input" style={{ width: 'auto', minHeight: 38 }} value={q.difficulty} onChange={(e) => set(i, { difficulty: e.target.value })} aria-label={`Slot ${q.slot} difficulty`}>
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {q.variant === 1 && <p className="cap">Swap slot: members get version 1 or version 2. Keep both the same difficulty.</p>}
            <input className="input" placeholder="Question" value={q.prompt} onChange={(e) => set(i, { prompt: e.target.value })} aria-label={`Slot ${q.slot} question`} />
            <div className="adm-opts">
              {q.options.map((o, j) => (
                <label key={j} className="adm-opt">
                  <input type="radio" name={`c-${i}`} checked={q.correct === j} onChange={() => set(i, { correct: j })} aria-label={`Answer ${'ABCD'[j]} is right`} />
                  <input className="input" placeholder={`Answer ${'ABCD'[j]}`} value={o}
                         onChange={(e) => set(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} />
                </label>
              ))}
            </div>
            <input className="input" placeholder="Fact shown after answering (one short line)" value={q.fact} onChange={(e) => set(i, { fact: e.target.value })} aria-label={`Slot ${q.slot} fact`} />
          </div>
        ))}
      </fieldset>

      <p className="cap">{complete ? 'All 13 questions filled.' : 'Fill every question and all four answers before saving.'} The round button marks the right answer; members see the answers shuffled.</p>
      <div className="adm-bar">
        <label className="check" style={{ alignItems: 'center' }}><input type="checkbox" checked={prize} disabled={locked} onChange={(e) => setPrize(e.target.checked)} /><span>Prize quiz</span></label>
        {prize && <label className="row cap" style={{ gap: 6 }}>starts <input type="time" className="input" style={{ minHeight: 38, width: 'auto' }} value={prizeStart} disabled={locked} onChange={(e) => setPrizeStart(e.target.value)} /> WAT</label>}
        <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={save} disabled={busy || locked}>{busy ? 'Saving…' : 'Save quiz'}</button>
        {msg && <p className={msg.ok ? 'ok' : 'err'} role="status" style={{ flexBasis: '100%', fontSize: 14 }}>{msg.text}</p>}
      </div>
    </div>
  );
}
