import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { mmss, whenLabel, type TakeRow } from '@/lib/takes';

export const metadata: Metadata = { title: 'Cold Takes', description: 'A sharp football opinion at 12pm and 6pm, and an Oracle video every Wednesday. Vote, then make your case.' };
export const dynamic = 'force-dynamic';

export default async function TakesPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from('takes').select('id, slug, kind, title, question, body, call_line, published_at, video')
    .order('published_at', { ascending: false }).limit(30);
  const takes = (data ?? []) as TakeRow[];
  const { data: replies } = await supabase.from('replies').select('take_id').in('take_id', takes.map((t) => t.id).concat(-1));
  const count = (id: number) => (replies ?? []).filter((r) => r.take_id === id).length;

  // This week's Oracle video sits on top for a week.
  const pinned = takes.find((t) => t.kind === 'video' && Date.now() - Date.parse(t.published_at) < 7 * 86400000);
  const rest = takes.filter((t) => t !== pinned);

  return (
    <div className="wrap page">
      <div className="pagehead">
        <p className="eyebrow">The Oracle picks a fight twice a day</p>
        <h1 className="display d-l">Cold Takes</h1>
        <p className="muted" style={{ maxWidth: '40em' }}>A sharp opinion at 12pm and 6pm, and a short Oracle video every Wednesday. Read or watch, vote, then make your case in the Dressing Room.</p>
      </div>
      <div className="stack" style={{ maxWidth: 860 }}>
        {pinned && <TakeCard t={pinned} replies={count(pinned.id)} big />}
        {rest.map((t) => <TakeCard key={t.id} t={t} replies={count(t.id)} />)}
        {takes.length === 0 && <div className="card"><p className="muted">The first take lands at 12pm on launch day.</p></div>}
      </div>
    </div>
  );
}

function TakeCard({ t, replies, big }: { t: TakeRow; replies: number; big?: boolean }) {
  const video = t.kind === 'video';
  return (
    <Link href={`/takes/${t.slug}`} className="card stack" style={{ textDecoration: 'none', color: 'var(--ink)', gap: 10, borderColor: big ? 'var(--gold)' : undefined }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className={`chip ${video ? 'cyan' : 'mag'}`}>{video ? 'Oracle video' : 'Cold Take'}</span>
        <span className="cap">{whenLabel(t.published_at)}{video && t.video?.episode ? ` · Episode ${t.video.episode}` : ''}{video && t.video?.length_s ? ` · ${mmss(t.video.length_s)}` : ''}</span>
      </div>
      <p className="headline" style={{ fontSize: big ? 'clamp(22px,2.6vw,28px)' : 20 }}>{t.title}</p>
      <div className="row cap" style={{ gap: 18, flexWrap: 'wrap' }}>
        {video && t.video?.oracle_call?.pick && <span>The call: {t.video.oracle_call.pick}</span>}
        <span>{replies} {replies === 1 ? 'reply' : 'replies'}</span>
        <span>Vote to see the split</span>
      </div>
    </Link>
  );
}
