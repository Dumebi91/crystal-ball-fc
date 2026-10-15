'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { friendly } from '@/lib/errors';

type PollT = { id: number; question: string; options: string[]; opens_at: string; closes_at: string };

export function Poll({ poll, myVote }: { poll: PollT; myVote: number | null }) {
  const supabase = supabaseBrowser();
  const [vote, setVote] = useState(myVote);
  const [split, setSplit] = useState<number[] | null>(null);
  const [error, setError] = useState('');
  const open = Date.now() >= Date.parse(poll.opens_at) && Date.now() < Date.parse(poll.closes_at);

  useEffect(() => {
    if (myVote !== null) supabase.rpc('poll_split', { p_poll: poll.id }).then(({ data }) => setSplit(data?.split ?? null));
  }, [myVote, poll.id, supabase]);

  async function cast(i: number) {
    const { data, error } = await supabase.rpc('vote_poll', { p_poll: poll.id, p_option: i });
    if (error) return setError(friendly(error.message));
    setVote(i); setSplit(data.split);
  }

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="between"><p className="eyebrow">Poll of the Day · 12pm</p><span className="cap">{vote !== null ? '+1 point' : open ? 'Tap to vote · +1 point' : 'Opens at 12pm'}</span></div>
      <p className="headline">{poll.question}</p>
      <div className="grid3" style={{ gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))' }}>
        {poll.options.map((o, i) => (
          <button key={i} className={`opt vote${vote === i ? ' mine' : ''}`} aria-pressed={vote === i} disabled={vote !== null || !open} onClick={() => cast(i)}>
            <span className="fill" style={{ width: `${split ? split[i] : 0}%` }} />
            <span style={{ flex: 1 }}>{o}</span>
            {split && <b className="num">{split[i]}%</b>}
          </button>
        ))}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}
