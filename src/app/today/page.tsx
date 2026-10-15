import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getMe } from '@/lib/session';
import { currentMatchweek } from '@/lib/matchweek';
import { lagosDate } from '@/lib/time';
import { Poll } from './Poll';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const { me } = await getMe();
  if (!me) redirect('/join');
  const supabase = await supabaseServer();
  const today = lagosDate();
  const mw = await currentMatchweek();

  const [{ data: quiz }, { data: poll }, { data: fixtures }] = await Promise.all([
    supabase.from('kb_quizzes').select('id').eq('quiz_date', today).maybeSingle(),
    supabase.from('polls').select('id, question, options, opens_at, closes_at').eq('poll_date', today).maybeSingle(),
    supabase.from('fixtures').select('id, kickoff_at').eq('matchweek_id', mw?.id ?? -1).eq('featured', true),
  ]);
  const { data: latest } = await supabase.from('takes').select('slug, kind, title, published_at, video')
    .order('published_at', { ascending: false }).limit(6);
  const take = (latest ?? []).find((t) => t.kind === 'take');
  const video = (latest ?? []).find((t) => t.kind === 'video' && Date.now() - Date.parse(t.published_at) < 7 * 86400000);
  const { data: attempt } = quiz
    ? await supabase.from('kb_attempts').select('status, score').eq('quiz_id', quiz.id).maybeSingle()
    : { data: null };
  const { count: called } = await supabase.from('calls').select('fixture_id', { count: 'exact', head: true })
    .in('fixture_id', (fixtures ?? []).map((f) => f.id));
  const { data: myVote } = poll ? await supabase.from('poll_votes').select('option').eq('poll_id', poll.id).maybeSingle() : { data: null };
  const { data: week } = await supabase.from('weekly_scores').select('points').eq('matchweek_id', mw?.id ?? -1).eq('user_id', me.id).maybeSingle();

  const total = fixtures?.length ?? 0;
  const done = attempt?.status === 'done';
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', hour12: false }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="wrap page">
      <div className="pagehead">
        <p className="cap">{mw?.label ?? ''}</p>
        <h1 className="display d-l">{greeting}, {me.handle}</h1>
      </div>
      <div className="cols">
        <div className="main">
          {video && (
            <Link href={`/takes/${video.slug}`} className="card stack" style={{ gap: 8, textDecoration: 'none', color: 'var(--ink)', border: '1.5px solid var(--gold)' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><p className="eyebrow">New from the Oracle</p>{video.video?.episode && <span className="cap">Episode {video.video.episode}</span>}</div>
              <p className="headline">{video.title}</p>
              {video.video?.oracle_call?.pick && <p className="cap">The Oracle's call: {video.video.oracle_call.game ? `${video.video.oracle_call.game}, ` : ''}{video.video.oracle_call.pick}. Think you know better?</p>}
              <span className="btn primary sm" style={{ alignSelf: 'flex-start' }}>Watch now</span>
            </Link>
          )}
          <div className="grid2" style={{ gap: 18 }}>
            <div className="card stack" style={{ gap: 12 }}>
              <div className="between"><p className="eyebrow">Know Ball · 9am</p><span className={`chip ${done ? 'cyan' : 'gold'}`}>{done ? 'Played' : quiz ? 'Live' : 'No quiz'}</span></div>
              <p className="display d-m">{done ? `${attempt?.score}/10` : 'Ten questions. One clock.'}</p>
              <p className="cap">{done ? 'Next quiz tomorrow at 9am.' : '10 questions, 60 seconds. Closes at midnight.'}</p>
              <Link href="/knowball" className={`btn ${done ? 'ghost' : 'primary'} block`} style={{ marginTop: 'auto' }}>{done ? 'See my result' : 'Play Know Ball'}</Link>
            </div>
            <div className="card stack" style={{ gap: 12 }}>
              <div className="between"><p className="eyebrow">Call It · {mw?.label ?? ''}</p></div>
              <p className="display d-m">{called ?? 0}/{total} called</p>
              <div className="bar"><span style={{ width: `${total ? Math.round(((called ?? 0) / total) * 100) : 0}%`, background: 'var(--violet-text)' }} /></div>
              <Link href="/callit" className="btn ghost block" style={{ marginTop: 'auto' }}>{(called ?? 0) < total ? 'Finish my calls' : 'Review my calls'}</Link>
            </div>
          </div>
          {poll && <Poll poll={poll} myVote={myVote?.option ?? null} />}
          {take && (
            <Link href={`/takes/${take.slug}`} className="card stack" style={{ gap: 10, textDecoration: 'none', color: 'var(--ink)' }}>
              <div className="row"><span className="chip mag">Cold Take</span></div>
              <p className="headline">{take.title}</p>
              <span className="vio" style={{ fontWeight: 600, fontSize: 14 }}>Agree or disagree? Vote inside</span>
            </Link>
          )}
        </div>
        <aside className="rail">
          <div className="card stack" style={{ gap: 6 }}>
            <p className="eyebrow">This week</p>
            <p className="num" style={{ fontSize: 34, fontWeight: 700 }}>{week?.points ?? 0} <span className="cap">pts</span></p>
            <Link href="/table" className="linkbtn" style={{ alignSelf: 'flex-start' }}>See the table</Link>
          </div>
          {me.founding_number && (
            <div className="panel"><p className="eyebrow">Founding Oracle No. {me.founding_number}</p><p className="cap" style={{ color: 'var(--ink)' }}>One of the first 1,000. The badge is yours for life.</p></div>
          )}
        </aside>
      </div>
    </div>
  );
}
