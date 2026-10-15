export type TakeRow = {
  id: number; slug: string; kind: 'take' | 'video'; title: string; question: string;
  body: any[]; call_line: string | null; published_at: string;
  video: { url?: string; episode?: number | null; length_s?: number; oracle_call?: { game?: string; pick?: string; note?: string } } | null;
};

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function whenLabel(iso: string) {
  const d = new Date(iso);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(' ', '').toLowerCase();
  if (day === today) return `Today, ${time}`;
  const y = new Date(Date.now() - 86400000);
  if (day === new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(y)) return `Yesterday, ${time}`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/** Turn a YouTube or TikTok link into an embeddable player address. Anything else is treated as a video file. */
export function embedFor(url: string | undefined, start = 0): { src: string; kind: 'iframe' | 'file'; vertical: boolean } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let yt: string | null = null;
    if (host === 'youtu.be') yt = u.pathname.slice(1);
    if (host === 'youtube.com') yt = u.searchParams.get('v') ?? u.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1] ?? null;
    if (yt) {
      // The no-cookie player sets no tracking cookies until the viewer plays.
      return { src: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&start=${Math.floor(start)}`, kind: 'iframe', vertical: u.pathname.includes('/shorts/') };
    }
    const tt = host.endsWith('tiktok.com') ? u.pathname.match(/\/video\/(\d+)/)?.[1] : null;
    if (tt) return { src: `https://www.tiktok.com/embed/v2/${tt}`, kind: 'iframe', vertical: true };
    return { src: url, kind: 'file', vertical: true };
  } catch {
    return null;
  }
}
