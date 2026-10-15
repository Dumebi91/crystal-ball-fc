'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { friendly } from '@/lib/errors';
import { Spark } from '@/components/Icon';

type Quiz = { id: number; opens_at: string; closes_at: string; is_prize: boolean } | null;
type Attempt = { id: string; status: string; score: number | null; used_ms: number; timed_out: boolean } | null;
type Question = { status: 'playing'; index: number; total: number; difficulty: string; prompt: string; options: string[]; remaining_ms: number };
type Result = { status: 'done'; score: number; points?: number; used_ms: number; timed_out: boolean };
type Feedback = { correct: boolean; correct_index: number; fact: string; chosen: number; done: boolean; result: Result | null };

const LEVEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', home: 'Home colours' };

/**
 * The clock shown here is only a display. The server keeps the real clock: it starts when a question
 * is served and stops when it's answered, so pausing, reloading or changing the phone's time changes nothing.
 */
export function KnowBall({ quiz, attempt }: { quiz: Quiz; attempt: Attempt }) {
  const supabase = supabaseBrowser();
  const [attemptId, setAttemptId] = useState<string | null>(attempt?.status === 'playing' ? attempt.id : null);
  const [q, setQ] = useState<Question | null>(null);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [result, setResult] = useState<Result | null>(
    attempt?.status === 'done' ? { status: 'done', score: attempt.score ?? 0, used_ms: attempt.used_ms, timed_out: attempt.timed_out } : null,
  );
  const [left, setLeft] = useState(60000);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const deadline = useRef<number | null>(null);

  const load = useCallback(async (id: string) => {
    const { data, error } = await supabase.rpc('kb_question', { p_attempt: id });
    if (error) return setError(friendly(error.message));
    if (data.status === 'done') { setResult(data); setQ(null); deadline.current = null; return; }
    setFb(null); setQ(data); setLeft(data.remaining_ms);
    deadline.current = performance.now() + data.remaining_ms;
  }, [supabase]);

  // Resume a quiz already in progress (the server clock kept running).
  useEffect(() => { if (attemptId && !q && !result) load(attemptId); }, [attemptId, q, result, load]);

  // Display clock. When it reaches zero, ask the server, which decides.
  useEffect(() => {
    if (!q || fb) return;
    const t = setInterval(() => {
      if (deadline.current == null) return;
      const ms = Math.max(0, deadline.current - performance.now());
      setLeft(ms);
      if (ms === 0 && attemptId) { clearInterval(t); load(attemptId); }
    }, 100);
    return () => clearInterval(t);
  }, [q, fb, attemptId, load]);

  async function start() {
    setBusy(true); setError('');
    const { data, error } = await supabase.rpc('kb_start');
    setBusy(false);
    if (error) return setError(friendly(error.message));
    setAttemptId(data);
    load(data);
  }

  async function answer(choice: number) {
    if (!attemptId || !q || fb || busy) return;
    setBusy(true);
    deadline.current = null; // the server stops the clock on answer
    const { data, error } = await supabase.rpc('kb_answer', { p_attempt: attemptId, p_choice: choice });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    if (data.status === 'done') { setResult(data); setQ(null); return; } // ran out of time
    setFb({ ...data, chosen: choice });
    setTimeout(() => {
      if (data.done) { setResult(data.result); setQ(null); setFb(null); }
      else load(attemptId);
    }, 1500);
  }

  if (!quiz) {
    return <Card><p className="eyebrow">Know Ball</p><h1 className="display d-l">No quiz today</h1><p className="muted">Check back tomorrow at 9am.</p></Card>;
  }

  if (result) {
    const pts = result.points ?? result.score + (result.score === 10 ? 5 : 0);
    return (
      <Card>
        <p className="eyebrow">Today's Know Ball</p>
        <p className="num" style={{ fontSize: 80, fontWeight: 700, lineHeight: 1 }}>{result.score}/10</p>
        <p className="cap">{result.timed_out ? 'Time ran out.' : `In ${(result.used_ms / 1000).toFixed(1)} seconds.`}</p>
        <p className="display d-m">
          {result.score === 10 ? 'Perfect. The stars are with you.' : result.score >= 7 ? 'Solid. You know ball.' : result.score >= 4 ? 'Not bad. Tomorrow is yours.' : 'Cloudy stars today.'}
        </p>
        <p><b className="gold num" style={{ fontSize: 28 }}>+{pts}</b> <span className="cap">points</span></p>
        <Link href="/callit" className="btn primary" style={{ alignSelf: 'flex-start' }}>Now call the weekend</Link>
      </Card>
    );
  }

  if (!q) {
    const now = Date.now();
    const notYet = now < Date.parse(quiz.opens_at);
    return (
      <Card>
        <p className="eyebrow">Know Ball{quiz.is_prize ? ' · Prize quiz' : ''}</p>
        <h1 className="display d-xl" style={{ fontSize: 'clamp(36px,5vw,60px)' }}>Ten questions. One clock.</h1>
        <p className="muted" style={{ maxWidth: '36em' }}>
          A point for every right answer and 5 more for 10/10. The clock only runs while a question is on screen. One go, open until midnight.
        </p>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={start} disabled={busy || notYet || !!attemptId}>
          <Spark />{notYet ? 'Opens at 9am' : busy || attemptId ? 'Loading…' : 'Start the clock'}
        </button>
      </Card>
    );
  }

  const secs = Math.ceil(left / 1000);
  return (
    <Card>
      <div className="between" style={{ flexWrap: 'nowrap' }}>
        <div className="stack" style={{ gap: 6, minWidth: 0, flex: 1 }}>
          <p className="eyebrow">Question {q.index + 1} of 10 · {LEVEL[q.difficulty] ?? q.difficulty}</p>
        </div>
        <div className="clock" role="timer" aria-label={`${secs} seconds left`}>
          <svg viewBox="0 0 76 76"><circle className="track" cx="38" cy="38" r="33" />
            <circle className={`prog${left < 10000 ? ' low' : ''}`} cx="38" cy="38" r="33" strokeDasharray="207.3" strokeDashoffset={207.3 * (1 - left / 60000)} />
          </svg>
          <b>{secs}</b>
        </div>
      </div>
      <p className="headline" style={{ fontSize: 'clamp(21px,2.6vw,28px)' }}>{q.prompt}</p>
      <div className="grid2" style={{ gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))' }}>
        {q.options.map((o, j) => {
          const cls = fb ? (j === fb.correct_index ? ' right' : j === fb.chosen ? ' wrong' : '') : '';
          return (
            <button key={j} className={'opt' + cls} onClick={() => answer(j)} disabled={!!fb || busy}>
              <span className="key">{'ABCD'[j]}</span><span>{o}</span>
              <span className="note">{fb && j === fb.correct_index ? 'Right' : fb && j === fb.chosen ? 'Your answer' : ''}</span>
            </button>
          );
        })}
      </div>
      {fb && (
        <div className="panel row" role="status">
          <b className={fb.correct ? 'cyan' : 'magenta'} style={{ flex: 'none' }}>{fb.correct ? 'Called it.' : 'Missed.'}</b>
          <span style={{ fontSize: 15 }}>{fb.fact}</span>
        </div>
      )}
      {error && <p className="err" role="alert">{error}</p>}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card stack" style={{ gap: 18, padding: 'clamp(22px,4vw,40px)' }}>{children}</div>;
}
