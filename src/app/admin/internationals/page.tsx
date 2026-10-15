import { supabaseServer } from '@/lib/supabase/server';
import { IntPicker } from './IntPicker';

export default async function InternationalsAdmin() {
  const supabase = await supabaseServer();
  const now = Date.now();
  const [{ data: fixtures }, { data: ranks }] = await Promise.all([
    supabase.rpc('admin_int_fixtures', { p_from: new Date(now - 2 * 86400000).toISOString(), p_to: new Date(now + 45 * 86400000).toISOString() }),
    supabase.from('top_nations').select('name, fifa_rank').order('fifa_rank'),
  ]);
  return <IntPicker fixtures={fixtures ?? []} ranks={ranks ?? []} />;
}
