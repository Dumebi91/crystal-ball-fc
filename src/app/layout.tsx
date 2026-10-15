import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
// Fonts are bundled with the site, so no visitor data goes to Google.
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import './globals.css';
import { getMe } from '@/lib/session';
import { NavLinks, TabBar } from '@/components/TabBar';


export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.crystalballfc.com'),
  title: { default: 'Crystal Ball FC', template: '%s · Crystal Ball FC' },
  description: 'A free daily football game. Call the scores, beat the clock on Know Ball and climb from Apprentice to Prophet.',
  icons: { icon: '/brand/orb.svg' },
};

export const viewport: Viewport = { themeColor: '#0e0b26', viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { me } = await getMe();
  return (
    <html lang="en-NG">
      <body className={me ? 'has-tabs' : undefined}>
        <header className="top">
          <div className="wrap">
            <Link className="brand" href={me ? '/today' : '/'} aria-label="Crystal Ball FC home">
              <img className="full" src="/brand/lockup.svg" alt="Crystal Ball FC" />
              <img className="orb" src="/brand/orb.svg" alt="Crystal Ball FC" />
            </Link>
            <NavLinks member={!!me} />
            <div className="hright">
              {me ? (
                <Link href="/me" className="avatar" aria-label="Your profile">
                  {me.handle.slice(0, 2).toUpperCase()}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="linkbtn" style={{ color: 'var(--ink)' }}>Sign in</Link>
                  <Link href="/login" className="btn ghost sm">Join</Link>
                </>
              )}
            </div>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="foot">
          <div className="wrap">
            <img src="/brand/orb.svg" alt="" style={{ width: 30, height: 'auto' }} />
            <nav className="row" aria-label="Footer" style={{ flexWrap: 'wrap', gap: '8px 22px', fontSize: 14, flex: 1 }}>
              <Link href="/how">How it works</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/privacy">Privacy</Link>
            </nav>
            <p className="cap">© 2026 Crystal Ball FC. Free to play. No betting, no odds, no tips. Not affiliated with any club, league or betting company.</p>
          </div>
        </footer>
        {me ? <TabBar /> : null}
      </body>
    </html>
  );
}
