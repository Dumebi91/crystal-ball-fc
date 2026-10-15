import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getMe } from '@/lib/session';
import { whenLabel, type TakeRow } from '@/lib/takes';
import { Vote } from './Vote';
import { DressingRoom } from './DressingRoom';
import { VideoPlayer } from './VideoPlayer';

export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase.from('takes').select('id, slug, kind, title, question, body, call_line, published_at, video').eq('slug', slug).maybeSingle();
  return data as TakeRow | null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = await load((await params).slug);
  return t ? { title: t.title, description: t.kind === 'video' ? `The Oracle explains: ${t.title}` : t.call_line ?? t.title } : {};
}

export default async function TakePage({ params }: { params: Promise<{ slug: string }> }) {
  const t = await load((await params).slug);
  if (!t) notFound();
  const supabase = await supabaseServer();
  const { me } = await getMe();
  const [{ data: myVote }, { data: split }, { data: replies }, { data: more }] = await Promise.all([
    me ? supabase.from('take_votes').select('side').eq('take_id', t.id).maybeSingle() : Promise.resolve({ data: null }),
    me ? supabase.rpc('take_split', { p_take: t.id }) : Promise.resolve({ data: null }),
    supabase.from('replies').select('id, user_id, side, body, hidden, created_at, profiles(handle)').eq('take_id', t.id).order('created_at', { ascending: false }).limit(200),
    supabase.from('takes').select('slug, title, kind').neq('id', t.id).order('published_at', { ascending: false }).limit(4),
  ]);
  const video = t.kind === 'video';
  const call = t.video?.oracle_call;

  return (
    <div className="wrap page">
      <Link href="/takes" className="linkbtn" style={{ display: 'inline-block', marginBottom: 8 }}>← All Cold Takes</Link>
      <div className="cols" style={{ gap: 'clamp(24px,4vw,48px)' }}>
        <article className="main" style={{ maxWidth: video ? undefined : 720 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className={`chip ${video ? 'cyan' : 'mag'}`}>{video ? 'Oracle video' : 'Cold Take'}</span>
            <span className="cap">The Oracle · {whenLabel(t.published_at)}{video && t.video?.episode ? ` · Episode ${t.video.episode}` : ''}</span>
          </div>
          <h1 style={{ fontSize: 'clamp(28px,3.4vw,42px)', lineHeight: 1.2, fontWeight: 600, textWrap: 'balance' }}>{t.title}</h1>

          {video ? (
            <VideoPlayer url={t.video?.url} title={t.title} lines={t.body as { t: number; x: string }[]} />
          ) : (
            <div className="stack" style={{ gap: 18, fontSize: 18, lineHeight: 1.7 }}>
              {(t.body as string[]).map((p, i) => <p key={i}>{p}</p>)}
              {t.call_line && <p style={{ fontWeight: 600, borderTop: '1px solid var(--line)', paddingTop: 18 }}>Here's the call: {t.call_line}</p>}
              <p className="muted">You sabi ball? Tell us we're wrong.</p>
            </div>
          )}

          {video && call?.pick && (
            <div className="card callbox stack" style={{ gap: 8, border: '1.5px solid var(--gold)' }}>
              <p className="eyebrow">The Oracle's call</p>
              {call.game && <p className="cap" style={{ color: 'var(--ink)' }}>{call.game}</p>}
              <p className="display gold" style={{ fontSize: 30 }}>{call.pick}</p>
              {call.note && <p className="cap">{call.note}</p>}
              <Link href={me ? '/callit' : '/login'} className="btn primary sm" style={{ alignSelf: 'flex-start' }}>{me ? 'Think you know better? Make your call' : 'Join to make your call'}</Link>
            </div>
          )}

          <Vote takeId={t.id} question={t.question} signedIn={!!me} initialVote={myVote?.side ?? null} initialSplit={split} />
          <DressingRoom takeId={t.id} me={me ? { id: me.id, handle: me.handle } : null}
                        replies={(replies ?? []).map((r: any) => ({ id: r.id, user_id: r.user_id, side: r.side, body: r.body, hidden: r.hidden, created_at: r.created_at, handle: r.profiles?.handle ?? 'former member' }))} />
        </article>
        <aside className="rail" style={{ maxWidth: 400 }}>
          <div className="card stack" style={{ gap: 10 }}>
            <p className="eyebrow">Put it on the record</p>
            <p className="headline" style={{ fontSize: 19 }}>Think you can call it better?</p>
            <Link href={me ? '/callit' : '/login'} className="btn primary">Call this weekend's games</Link>
          </div>
          <div className="panel"><p className="eyebrow">House rules</p><p className="cap" style={{ color: 'var(--ink)', marginTop: 6 }}>Banter yes, abuse no. No politics, religion or tribe. No betting tips or links. Reported replies are hidden until a Steward reviews them.</p></div>
          {(more ?? []).length > 0 && (
            <div className="card stack" style={{ gap: 4, padding: 20 }}>
              <p className="eyebrow">More takes</p>
              {more!.map((m) => <Link key={m.slug} href={`/takes/${m.slug}`} style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 600, fontSize: 15, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>{m.kind === 'video' ? '▶ ' : ''}{m.title}</Link>)}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
