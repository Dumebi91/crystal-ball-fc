'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Take = {
  id: number; slug: string; kind: 'take' | 'video'; title: string; question: string; body: any[]; call_line: string | null;
  video: { url?: string; episode?: number; length_s?: number; oracle_call?: { game?: string; pick?: string; note?: string } } | null;
  published_at: string | null; votes: number; replies: number;
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/** Lagos wall-clock parts of a timestamp, for the date and time inputs. */
function lagosParts(iso: string | null) {
  if (!iso) return { date: '', time: '12:00' };
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Transcript lines for videos are written "0:05 | What the Oracle says".
function bodyToText(t: Take | null) {
  if (!t) return '';
  return t.kind === 'video'
    ? t.body.map((l: any) => `${Math.floor(l.t / 60)}:${String(l.t % 60).padStart(2, '0')} | ${l.x}`).join('\n')
    : t.body.join('\n\n');
}
function textToBody(kind: string, text: string) {
  if (kind === 'video') {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [time, ...rest] = l.split('|');
      const [m, s] = time.trim().split(':').map(Number);
      return { t: (m || 0) * 60 + (s || 0), x: rest.join('|').trim() };
    });
  }
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export function TakesAdmin({ takes }: { takes: Take[] }) {
  const [editing, setEditing] = useState<Take | 'new' | null>(null);
  if (editing) return <TakeForm take={editing === 'new' ? null : editing} done={() => setEditing(null)} />;
  return (
    <div className="stack">
      <div className="between"><h1 className="display d-m">Takes & Oracle videos</h1><button className="btn primary sm" onClick={() => setEditing('new')}>New take or video</button></div>
      <div className="card" style={{ padding: '6px 16px' }}>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Title</th><th>Type</th><th>Goes live (WAT)</th><th className="r">Votes</th><th className="r">Replies</th><th></th></tr></thead>
            <tbody>
              {takes.map((t) => {
                const p = lagosParts(t.published_at);
                return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.title}</td>
                    <td>{t.kind === 'video' ? 'Oracle video' : 'Cold Take'}</td>
                    <td className={t.published_at ? '' : 'warn'}>{t.published_at ? `${p.date} ${p.time}` : 'Draft'}</td>
                    <td className="r num">{t.votes}</td><td className="r num">{t.replies}</td>
                    <td className="r"><button className="linkbtn" onClick={() => setEditing(t)}>Edit</button></td>
                  </tr>
                );
              })}
              {takes.length === 0 && <tr><td colSpan={6} className="muted">Nothing yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TakeForm({ take, done }: { take: Take | null; done: () => void }) {
  const router = useRouter();
  const start = lagosParts(take?.published_at ?? null);
  const [kind, setKind] = useState<'take' | 'video'>(take?.kind ?? 'take');
  const [title, setTitle] = useState(take?.title ?? '');
  const [slug, setSlug] = useState(take?.slug ?? '');
  const [question, setQuestion] = useState(take?.question ?? 'Agree or disagree?');
  const [body, setBody] = useState(bodyToText(take));
  const [callLine, setCallLine] = useState(take?.call_line ?? '');
  const [videoUrl, setVideoUrl] = useState(take?.video?.url ?? '');
  const [episode, setEpisode] = useState(String(take?.video?.episode ?? ''));
  const [call, setCall] = useState(take?.video?.oracle_call ?? { game: '', pick: '', note: '' });
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [msg, setMsg] = useState('');

  async function save(publish: boolean) {
    const parsed = textToBody(kind, body);
    const len = kind === 'video' && parsed.length ? Math.max(...parsed.map((l: any) => l.t)) + 6 : undefined;
    const { error } = await supabaseBrowser().rpc('admin_save_take', {
      p_id: take?.id ?? null,
      p_slug: slug || slugify(title),
      p_kind: kind,
      p_title: title,
      p_question: question,
      p_body: parsed,
      p_call_line: callLine || null,
      p_video: kind === 'video' ? { url: videoUrl, episode: Number(episode) || null, length_s: len, oracle_call: call } : null,
      p_published_at: publish && date ? `${date}T${time}:00+01:00` : null,
    });
    if (error) {
      return setMsg(error.message.includes('duplicate') ? 'Another take already uses that web address. Change the slug.'
        : error.message.includes('bad_slug') ? 'The slug can only use lowercase letters, numbers and dashes.'
        : 'A take needs a title and a question.');
    }
    router.refresh();
    done();
  }

  return (
    <div className="card stack" style={{ maxWidth: 860, gap: 14 }}>
      <div className="between"><h1 className="display d-m">{take ? 'Edit' : 'New'} {kind === 'video' ? 'Oracle video' : 'Cold Take'}</h1><button className="linkbtn" onClick={done}>Back to the list</button></div>
      <div className="pills" role="group" aria-label="Type">
        <button type="button" className="pill" aria-pressed={kind === 'take'} onClick={() => setKind('take')}>Cold Take</button>
        <button type="button" className="pill" aria-pressed={kind === 'video'} onClick={() => setKind('video')}>Oracle video</button>
      </div>
      <div className="field"><label htmlFor="tt">Title</label><input id="tt" className="input" value={title} onChange={(e) => { setTitle(e.target.value); if (!take) setSlug(slugify(e.target.value)); }} /></div>
      <div className="field"><label htmlFor="ts">Web address</label><input id="ts" className="input" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} /><span className="cap">crystalballfc.com/takes/{slug || '…'}</span></div>
      <div className="field"><label htmlFor="tq">What members vote on</label><input id="tq" className="input" value={question} onChange={(e) => setQuestion(e.target.value)} /></div>
      <div className="field">
        <label htmlFor="tb">{kind === 'video' ? 'Transcript, one line each: 0:05 | What the Oracle says' : 'The take (leave a blank line between paragraphs)'}</label>
        <textarea id="tb" className="input" rows={kind === 'video' ? 10 : 8} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {kind === 'take' && <div className="field"><label htmlFor="tc">"Here's the call" line</label><input id="tc" className="input" value={callLine} onChange={(e) => setCallLine(e.target.value)} /></div>}
      {kind === 'video' && (
        <div className="grid2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="vu">Video link (YouTube, TikTok or the video host)</label><input id="vu" className="input" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} /></div>
          <div className="field"><label htmlFor="ve">Episode number</label><input id="ve" className="input" inputMode="numeric" value={episode} onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="field"><label htmlFor="vg">The Oracle's call: game</label><input id="vg" className="input" placeholder="Aston Villa v Brighton" value={call.game ?? ''} onChange={(e) => setCall({ ...call, game: e.target.value })} /></div>
          <div className="field"><label htmlFor="vp">The call</label><input id="vp" className="input" placeholder="Aston Villa 1–0" value={call.pick ?? ''} onChange={(e) => setCall({ ...call, pick: e.target.value })} /></div>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <label className="row cap" style={{ gap: 8 }}>Goes live <input type="date" className="input" style={{ minHeight: 42, width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <input type="time" className="input" style={{ minHeight: 42, width: 'auto' }} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time (WAT)" /><span className="cap">WAT</span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => save(true)} disabled={!date}>Schedule</button>
        <button className="btn ghost" onClick={() => save(false)}>Save as draft</button>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}
    </div>
  );
}
