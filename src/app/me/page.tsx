import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getMe } from '@/lib/session';
import { MyData } from './MyData';

export const metadata: Metadata = { title: 'Me' };
export const dynamic = 'force-dynamic';

const RANK = (p: number) => (p >= 1200 ? 'Oracle' : p >= 500 ? 'Seer' : p >= 150 ? 'Reader' : 'Apprentice');

export default async function MePage() {
  const { me } = await getMe();
  if (!me) redirect('/join');
  const supabase = await supabaseServer();
  const { data: season } = await supabase.from('season_scores').select('points').eq('user_id', me.id).maybeSingle();
  const pts = season?.points ?? 0;
  return (
    <div className="wrap page" style={{ maxWidth: 720 }}>
      <div className="card stack" style={{ alignItems: 'center', textAlign: 'center', gap: 10 }}>
        <span className="avatar lg">{me.handle.slice(0, 2).toUpperCase()}</span>
        <h1 style={{ fontSize: 23, fontWeight: 600 }}>@{me.handle}</h1>
        <p className="cap">{[me.city, me.club && `Supports ${me.club}`].filter(Boolean).join(' · ')}</p>
        <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="chip">{RANK(pts)}</span>
          {me.founding_number && <span className="chip gold">Founding Oracle No. {me.founding_number}</span>}
        </div>
        <p className="num" style={{ fontSize: 28, fontWeight: 700 }}>{pts.toLocaleString('en-GB')} <span className="cap">season pts</span></p>
      </div>
      <MyData />
    </div>
  );
}
