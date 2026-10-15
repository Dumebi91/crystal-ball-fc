import { supabaseServer } from '@/lib/supabase/server';
import { lagosDate } from '@/lib/time';
import { PollEditor } from './PollEditor';

export default async function PollAdmin({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const raw = (await searchParams).date;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : lagosDate();
  const supabase = await supabaseServer();
  const { data: poll } = await supabase.from('polls').select('question, options').eq('poll_date', date).maybeSingle();
  return <PollEditor key={date} date={date} saved={poll} />;
}
