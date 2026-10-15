'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { friendly } from '@/lib/errors';

export function JoinButton({ code }: { code: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  async function join() {
    const { data, error } = await supabaseBrowser().rpc('join_league', { p_code: code });
    if (error) return setError(friendly(error.message));
    router.push(`/leagues?id=${data}`);
  }
  return (<>
    <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={join}>Join the league</button>
    {error && <p className="err" role="alert">{error}</p>}
  </>);
}
