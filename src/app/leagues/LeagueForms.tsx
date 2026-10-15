'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { friendly } from '@/lib/errors';

const KINDS = ['Friends', 'Office', 'Fan club', 'Family'];

export function LeagueForms() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('Friends');
  const [code, setCode] = useState('');
  const [made, setMade] = useState<{ id: string; invite_code: string } | null>(null);
  const [error, setError] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const { data, error } = await supabase.rpc('create_league', { p_name: name, p_kind: kind });
    if (error) return setError(friendly(error.message));
    setMade(data); setName('');
    router.refresh();
  }
  async function join(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const { data, error } = await supabase.rpc('join_league', { p_code: code });
    if (error) return setError(friendly(error.message));
    router.push(`/leagues?id=${data}`); router.refresh();
  }
  const link = made ? `${location.origin}/l/${made.invite_code}` : '';

  return (
    <>
      <form className="card stack" onSubmit={create}>
        <p className="eyebrow">New league</p>
        <div className="field"><label htmlFor="ln">League name</label>
          <input id="ln" className="input" placeholder="Surulere Old Boys" minLength={3} maxLength={40} required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="pills" role="group" aria-label="Who's it for?">
          {KINDS.map((k) => <button type="button" key={k} className="pill" aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}
        </div>
        <button className="btn primary">Create league</button>
        {made && (
          <div className="panel stack" style={{ gap: 8 }}>
            <p className="cap" style={{ color: 'var(--ink)' }}>Share this link: <b style={{ overflowWrap: 'anywhere' }}>{link}</b></p>
            <button type="button" className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(link).catch(() => {})}>Copy invite link</button>
          </div>
        )}
        <p className="cap">Free. No prizes or entry fees: leagues are for bragging rights.</p>
      </form>
      <form className="card stack" onSubmit={join}>
        <p className="eyebrow">Got a code?</p>
        <input className="input" placeholder="e.g. K7Q2MX" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Invite code" />
        <button className="btn ghost">Join league</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
    </>
  );
}
