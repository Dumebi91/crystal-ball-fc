import { cache } from 'react';
import { supabaseServer } from './supabase/server';

export type Me = { id: string; handle: string; city: string | null; club: string | null; founding_number: number | null } | null;

/** The signed-in member's profile, once per request. Null when signed out or not yet joined. */
export const getMe = cache(async (): Promise<{ userId: string | null; me: Me }> => {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { userId: null, me: null };
  const { data: me } = await supabase
    .from('profiles')
    .select('id, handle, city, club, founding_number')
    .eq('id', data.user.id)
    .maybeSingle();
  return { userId: data.user.id, me: me ?? null };
});

export { friendly } from './errors';
