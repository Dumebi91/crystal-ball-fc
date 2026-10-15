import { supabaseServer } from '@/lib/supabase/server';
import { TakesAdmin } from './TakesAdmin';

export default async function TakesPage() {
  const supabase = await supabaseServer();
  const { data: takes } = await supabase.rpc('admin_list_takes');
  return <TakesAdmin takes={takes ?? []} />;
}
