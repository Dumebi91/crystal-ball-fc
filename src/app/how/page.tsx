import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'How it works' };

const GAMES = [
  ['Know Ball', '9am daily', '10 questions, 60 seconds. 1 point a right answer, plus 5 for all 10.'],
  ['Call It', 'Every matchweek', 'Call every Premier League score before kick-off. 10 points for the exact score, 3 for the right result.'],
  ['Poll of the Day', '12pm daily', 'One question, one tap. 1 point for voting.'],
  ['Cold Takes', '12pm and 6pm', 'A sharp opinion. Vote agree or disagree, then make your case.'],
  ['Leagues', 'Any time', 'Start a league for your office or friends. Same games, your own table.'],
];

export default function HowPage() {
  return (
    <div className="wrap page" style={{ maxWidth: 860 }}>
      <div className="pagehead"><p className="eyebrow">How it works</p><h1 className="display d-l">A reason to open it every day</h1></div>
      <div className="stack">
        {GAMES.map(([name, when, what]) => (
          <div key={name} className="card stack" style={{ gap: 6 }}>
            <div className="between"><p className="display d-s">{name}</p><span className="chip gold">{when}</span></div>
            <p className="muted">{what}</p>
          </div>
        ))}
        <div className="panel">
          <p className="eyebrow">The weekly crown</p>
          <p className="cap" style={{ color: 'var(--ink)' }}>The top scorer of each matchweek is crowned Oracle of the Week at noon the day after its last game. Ranks: Reader at 150 season points, Seer at 500, Oracle at 1,200, and the top 1% become Prophets in June.</p>
        </div>
        <p className="cap">Free to play, 18 and over. No betting, no odds, no tips. Full rules in the <Link href="/terms">Terms</Link>.</p>
      </div>
    </div>
  );
}
