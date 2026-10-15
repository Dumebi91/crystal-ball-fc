import { supabaseServer } from '@/lib/supabase/server';
import { Queue } from './Queue';

export default async function ModerationPage() {
  const supabase = await supabaseServer();
  const [{ data: reports }, { data: flags }] = await Promise.all([supabase.rpc('admin_open_reports'), supabase.rpc('admin_open_flags')]);
  return <Queue reports={reports ?? []} flags={flags ?? []} />;
}
