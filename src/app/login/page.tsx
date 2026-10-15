'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/** Nigerian numbers in any common form become +234...; other countries need the + and country code. */
function toE164(input: string): string | null {
  const d = input.replace(/[^\d+]/g, '');
  if (/^0\d{10}$/.test(d)) return '+234' + d.slice(1);
  if (/^234\d{10}$/.test(d)) return '+' + d;
  if (/^\+\d{8,15}$/.test(d)) return d;
  return null;
}

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/today';
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supabase = supabaseBrowser();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    if (!e164) return setError('Enter your phone number, for example 0803 123 4567.');
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (error) return setError("We couldn't send a code. Check the number and try again.");
    setSentTo(e164);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true); setError('');
    const { data, error } = await supabase.auth.verifyOtp({ phone: sentTo, token: code.trim(), type: 'sms' });
    if (error || !data.user) { setBusy(false); return setError("That code didn't work. Check it, or ask for a new one."); }
    const { data: profile } = await supabase.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
    router.replace(profile ? next : `/join?next=${encodeURIComponent(next)}`);
    router.refresh();
  }

  return (
    <div className="wrap page" style={{ maxWidth: 520 }}>
      <div className="card stack" style={{ gap: 18 }}>
        <p className="eyebrow">Join or sign in</p>
        <h1 className="display d-l">Claim your seat</h1>
        {!sentTo ? (
          <form className="stack" onSubmit={send}>
            <div className="field">
              <label htmlFor="phone">Your phone number</label>
              <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567"
                     value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <p className="cap">We'll text you a 6-digit code. Your number is never shown to anyone.</p>
            {error && <p className="err" role="alert">{error}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Text me a code'}</button>
          </form>
        ) : (
          <form className="stack" onSubmit={verify}>
            <div className="field">
              <label htmlFor="code">The code we sent to {sentTo}</label>
              <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}"
                     value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </div>
            {error && <p className="err" role="alert">{error}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
            <button type="button" className="linkbtn" onClick={() => { setSentTo(null); setCode(''); }}>Use a different number</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
