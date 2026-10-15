import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase/server';
import { lagosDate } from '@/lib/time';
import { KnowBall } from './KnowBall';

export const metadata: Metadata = { title: 'Know Ball' };
export const dynamic = 'force-dynamic';

export default async function KnowBallPage() {
  const supabase = await supabaseServer();
  const { data: quiz } = await supabase
    .from('kb_quizzes').select('id, opens_at, closes_at, is_prize').eq('quiz_date', lagosDate()).maybeSingle();
  const { data: attempt } = quiz
    ? await supabase.from('kb_attempts').select('id, status, score, used_ms, timed_out').eq('quiz_id', quiz.id).maybeSingle()
    : { data: null };

  return (
    <div className="wrap page">
      <div className="cols">
        <div className="main">
          <KnowBall quiz={quiz} attempt={attempt} />
        </div>
        <aside className="rail">
          <div className="card stack" style={{ gap: 10, padding: 20 }}>
            <p className="display d-s" style={{ fontSize: 17 }}>How it scores</p>
            <div className="between"><span className="muted">Each right answer</span><b className="gold">1 pt</b></div>
            <div className="between"><span className="muted">All 10 right</span><b className="gold">+5 pts</b></div>
            <div className="between"><span className="muted">Tie-break</span><b>Fastest time</b></div>
          </div>
          <div className="panel stack" style={{ gap: 6 }}>
            <p className="eyebrow">Fair play</p>
            <p className="cap" style={{ color: 'var(--ink)' }}>
              Your question order is your own, and some questions are swapped for others of the same difficulty. Sharing answers won't help your friends much.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
