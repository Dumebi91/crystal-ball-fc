'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';

type Split = { votes: number; agree: number; disagree: number } | null;

export function Vote({ takeId, question, signedIn, initialVote, initialSplit }:
  { takeId: number; question: string; signedIn: boolean; initialVote: string | null; initialSplit: Split }) {
  const [vote, setVote] = useState(initialVote);
  const [split, setSplit] = useState<Split>(initialSplit);
  const [error, setError] = useState('');

  async function cast(side: 'agree' | 'disagree') {
    const { data, error } = await supabaseBrowser().rpc('vote_take', { p_take: takeId, p_side: side });
    if (error) return setError("Your vote didn't go through. Try again.");
    setVote(side); setSplit(data);
  }

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <p className="eyebrow">Your call</p>
      <p style={{ fontWeight: 600, fontSize: 18 }}>{question}</p>
      {signedIn ? (
        <div className="grid2" style={{ gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))' }}>
          {(['agree', 'disagree'] as const).map((side) => (
            <button key={side} className={`opt vote${vote === side ? ' mine' : ''}`} aria-pressed={vote === side} disabled={!!vote} onClick={() => cast(side)}>
              <span className="fill" style={{ width: `${split ? split[side] : 0}%` }} />
              <span style={{ flex: 1 }}>{side === 'agree' ? 'Agree' : 'Disagree'}</span>
              {split && <b className="num">{split[side]}%</b>}
            </button>
          ))}
        </div>
      ) : (
        <div className="panel between"><span>Join to vote and see where the club stands.</span><Link href="/login" className="btn primary sm">Join free</Link></div>
      )}
      {signedIn && <p className="cap">{split ? `${split.votes.toLocaleString('en-GB')} votes. Now make your case below.` : 'Vote to see where the club stands. Votes are final.'}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}
