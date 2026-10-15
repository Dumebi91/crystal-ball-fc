import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getMe } from '@/lib/session';
import { JoinButton } from './JoinButton';

export const metadata: Metadata = { title: 'League invite' };

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await supabaseServer();
  const { me } = await getMe();
  const { data: league } = await supabase.rpc('league_by_code', { p_code: code });
  if (!league) return <div className="wrap page"><div className="card"><p className="muted">This invite link doesn't work. Ask for a new one.</p></div></div>;
  return (
    <div className="wrap page" style={{ maxWidth: 640 }}>
      <div className="card stack" style={{ gap: 14 }}>
        <p className="eyebrow">You're invited</p>
        <h1 className="display d-l">{league.name}</h1>
        <p className="muted"><b style={{ color: 'var(--ink)' }}>@{league.owner}</b> wants you in their league. {league.members} members are already calling scores.</p>
        {me ? <JoinButton code={code} /> : <Link href={`/login?next=/l/${code}`} className="btn primary" style={{ alignSelf: 'flex-start' }}>Join Crystal Ball FC to play</Link>}
        <p className="cap">Free to play. No betting, no odds, no tips.</p>
      </div>
    </div>
  );
}
