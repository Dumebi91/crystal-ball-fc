'use client';
import { useState } from 'react';
import { embedFor, mmss } from '@/lib/takes';

type Line = { t: number; x: string };

/**
 * Nothing loads from the video host until the viewer taps play, which saves data and keeps
 * third-party cookies away from people who only read. The transcript is always there.
 * Tapping a transcript line starts a YouTube video from that moment.
 */
export function VideoPlayer({ url, title, lines }: { url?: string; title: string; lines: Line[] }) {
  const [start, setStart] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const player = start === null ? null : embedFor(url, start);
  const vertical = embedFor(url)?.vertical ?? true;
  const isYouTube = !!url && /youtu/.test(url);

  function seek(i: number) {
    setActive(i);
    if (isYouTube || start === null) setStart(lines[i].t);
    document.getElementById('player')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="watch-grid">
      <div className="vcol">
        <div id="player" className="vp" style={{ aspectRatio: vertical ? '9 / 16' : '16 / 9', maxWidth: vertical ? 360 : '100%' }}>
          {player?.kind === 'iframe' ? (
            <iframe key={player.src} src={player.src} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
          ) : player?.kind === 'file' ? (
            <video src={player.src} controls autoPlay playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000' }} />
          ) : (
            <div className="vp-ov">
              <img src="/brand/orb.svg" alt="" style={{ width: 64, height: 'auto' }} />
              <p className="eyebrow">The Oracle explains</p>
              <p className="display" style={{ fontSize: 24, lineHeight: 1.15 }}>{title}</p>
              {url ? (
                <button className="bigplay" onClick={() => setStart(0)} aria-label="Play the video">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" /></svg>
                </button>
              ) : <p className="cap">The video is on its way.</p>}
              <p className="cap">Tap to play · loads the video · transcript below</p>
            </div>
          )}
        </div>
      </div>
      <div className="icol">
        <section className="card stack" style={{ gap: 6 }}>
          <div className="between" style={{ paddingBottom: 6 }}><h2 className="display d-s">Transcript</h2>{isYouTube && <span className="cap">Tap a line to jump there</span>}</div>
          <div className="tx">
            {lines.map((l, i) => (
              <button key={i} className={active === i ? 'on' : undefined} onClick={() => seek(i)}>
                <b>{mmss(l.t)}</b><span>{l.x}</span>
              </button>
            ))}
            {lines.length === 0 && <p className="cap">Transcript coming soon.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
