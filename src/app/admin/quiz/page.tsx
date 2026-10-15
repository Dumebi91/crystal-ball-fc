import { supabaseServer } from '@/lib/supabase/server';
import { lagosDate } from '@/lib/time';
import { QuizEditor } from './QuizEditor';

export default async function QuizAdmin({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const raw = (await searchParams).date;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : lagosDate();
  const supabase = await supabaseServer();
  const { data: quiz } = await supabase.rpc('admin_get_quiz', { p_date: date });
  return <QuizEditor key={date} date={date} saved={quiz} />;
}
