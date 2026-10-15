import { supabaseServer } from './supabase/server';

/** The matchweek running now, or the next one if we're between matchweeks. */
export async function currentMatchweek() {
  const supabase = await supabaseServer();
  const now = new Date().toISOString();
  const { data: running } = await supabase
    .from('matchweeks').select('id, label, starts_at, ends_at, season_id')
    .lte('starts_at', now).gt('ends_at', now).order('starts_at').limit(1).maybeSingle();
  if (running) return running;
  const { data: next } = await supabase
    .from('matchweeks').select('id, label, starts_at, ends_at, season_id')
    .gt('starts_at', now).order('starts_at').limit(1).maybeSingle();
  return next;
}
