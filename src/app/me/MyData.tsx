'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/** Download my data and delete my account (Privacy Policy s.7). */
export function MyData() {
  const supabase = supabaseBrowser();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');

  async function download() {
    const { data, error } = await supabase.rpc('export_my_data');
    if (error) return setMsg('Download failed. Please try again.');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'crystal-ball-fc-my-data.json'; a.click();
    URL.revokeObjectURL(url);
  }
  async function remove() {
    const { error } = await supabase.rpc('delete_my_account');
    if (error) return setMsg('Deleting failed. Email privacy@crystalballfc.com and we will do it for you.');
    await supabase.auth.signOut();
    location.href = '/';
  }

  return (
    <div className="card stack" style={{ marginTop: 20 }}>
      <p className="eyebrow">Your data</p>
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={download}>Download my data</button>
      {!confirming ? (
        <button className="linkbtn" style={{ alignSelf: 'flex-start', color: 'var(--magenta)' }} onClick={() => setConfirming(true)}>Delete my account</button>
      ) : (
        <div className="panel stack" style={{ gap: 10 }}>
          <p>This deletes your account, calls, replies and leagues you own. Your points stay in past tables as "former member". It can't be undone.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn sm" style={{ background: 'var(--magenta)', color: 'var(--midnight)' }} onClick={remove}>Yes, delete everything</button>
            <button className="btn ghost sm" onClick={() => setConfirming(false)}>Keep my account</button>
          </div>
        </div>
      )}
      <form action="/auth/signout" method="post"><button className="linkbtn">Sign out</button></form>
      {msg && <p className="err" role="alert">{msg}</p>}
    </div>
  );
}
