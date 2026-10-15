import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';
import { Spark } from '@/components/Icon';

export default async function Landing() {
  const { me } = await getMe();
  if (me) redirect('/today');
  return (
    <section className="hero">
      <div className="wrap">
        <div className="hero-copy">
          <p className="eyebrow">Launches Saturday 7 November</p>
          <h1 className="display d-xl">Think you know ball?</h1>
          <img src="/brand/call-it.svg" alt="Call it." style={{ height: 84, width: 'auto', alignSelf: 'flex-start' }} />
          <p className="muted" style={{ fontSize: 19, maxWidth: '32em' }}>
            A free daily football game. Call the scores, beat the clock on the morning quiz, and climb from Apprentice to Prophet.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Link href="/login" className="btn primary"><Spark />Join as a Founding Oracle</Link>
            <Link href="/how" className="btn ghost">How it works</Link>
          </div>
          <p className="cap">Free to play. No betting, no odds, no tips. 18 and over.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <img className="orbimg" src="/brand/orb.svg" alt="" />
        </div>
      </div>
    </section>
  );
}
