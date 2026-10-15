'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Enugu', 'Kano', 'Benin City', 'Elsewhere'];
const ERRORS: Record<string, string> = {
  must_be_18: 'Crystal Ball FC is for people aged 18 and over.',
  bad_handle: 'Handles are 3 to 20 letters, numbers or underscores.',
  handle_taken: 'That handle is taken. Try another.',
  profile_exists: 'You already have an account.',
};

function JoinForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/today';
  const [handle, setHandle] = useState('');
  const [city, setCity] = useState('Lagos');
  const [club, setClub] = useState('');
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabaseBrowser().rpc('create_profile', {
      p_handle: handle, p_city: city, p_club: club, p_confirmed_adult: adult,
    });
    setBusy(false);
    if (error) {
      const key = Object.keys(ERRORS).find((k) => error.message.includes(k));
      return setError(key ? ERRORS[key] : 'Something went wrong. Please try again.');
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="wrap page" style={{ maxWidth: 560 }}>
      <form className="card stack" style={{ gap: 18 }} onSubmit={submit}>
        <p className="eyebrow">One last step</p>
        <h1 className="display d-l">Pick your handle</h1>
        <div className="field">
          <label htmlFor="handle">Handle</label>
          <input id="handle" className="input" placeholder="knowsball_ade" maxLength={20} required
                 value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          <span className="cap">This is how you appear on the tables. Letters, numbers and underscores.</span>
        </div>
        <div className="field">
          <span className="flabel">Your city</span>
          <div className="pills" role="group" aria-label="Your city">
            {CITIES.map((c) => (
              <button type="button" key={c} className="pill" aria-pressed={city === c} onClick={() => setCity(c)}>{c}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="club">Your club (optional)</label>
          <input id="club" className="input" maxLength={40} value={club} onChange={(e) => setClub(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} required />
          <span>I'm 18 or over, and I agree to the <Link href="/terms" target="_blank">Terms</Link> and the <Link href="/privacy" target="_blank">Privacy Policy</Link>.</span>
        </label>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy || !adult}>{busy ? 'Creating…' : 'Create my account'}</button>
      </form>
    </div>
  );
}

export default function JoinPage() {
  return <Suspense><JoinForm /></Suspense>;
}
