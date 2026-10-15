import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { lagosDate } from '@/lib/time';

function dayLabel(d: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T00:00:00Z'));
}

export default async function AdminHome() {
  const supabase = await supabaseServer();
  const { data: role } = await supabase.rpc('my_role');
  const content = role === 'editor' || role === 'admin';
  const moderate = role === 'steward' || role === 'admin';
  const [{ data: cal }, { data: reports }, { data: flags }] = await Promise.all([
    content ? supabase.rpc('admin_content_calendar', { p_from: lagosDate(), p_days: 14 }) : Promise.resolve({ data: null }),
    moderate ? supabase.rpc('admin_open_reports') : Promise.resolve({ data: null }),
    moderate ? supabase.rpc('admin_open_flags') : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="stack" style={{ gap: 28 }}>
      {moderate && (
        <div className="grid2">
          <Link href="/admin/moderation" className="card stack" style={{ gap: 4, textDecoration: 'none', color: 'var(--ink)' }}>
            <p className="eyebrow">Reported replies</p>
            <p className="num" style={{ fontSize: 40, fontWeight: 700 }}>{reports?.length ?? 0}</p>
            <p className="cap">Hidden until a Steward keeps or removes them.</p>
          </Link>
          <Link href="/admin/moderation" className="card stack" style={{ gap: 4, textDecoration: 'none', color: 'var(--ink)' }}>
            <p className="eyebrow">Fair-play flags</p>
            <p className="num" style={{ fontSize: 40, fontWeight: 700 }}>{flags?.length ?? 0}</p>
            <p className="cap">Unusual answers for a person to check. A flag alone costs nobody points.</p>
          </Link>
        </div>
      )}
      {content && (
        <section className="stack">
          <div className="between"><h1 className="display d-m">The next 14 days</h1><span className="cap">Gold means something's missing</span></div>
          <div className="cal">
            {(cal ?? []).map((d: any) => {
              const quizOk = d.quiz_slots === 10;
              return (
                <div key={d.date} className="card stack" style={{ gap: 6, padding: 14, borderColor: quizOk && d.poll && d.takes > 0 ? 'var(--line)' : 'var(--gold)' }}>
                  <b>{dayLabel(d.date)}</b>
                  <Link href={`/admin/quiz?date=${d.date}`} className={quizOk ? 'ok' : 'warn'} style={{ fontSize: 14 }}>
                    Know Ball {quizOk ? '✓' : `${d.quiz_slots}/10`}{d.quiz_prize ? ' · prize' : ''}
                  </Link>
                  <Link href={`/admin/poll?date=${d.date}`} className={d.poll ? 'ok' : 'warn'} style={{ fontSize: 14 }}>Poll {d.poll ? '✓' : 'missing'}</Link>
                  <Link href="/admin/takes" className={d.takes > 0 ? 'ok' : 'warn'} style={{ fontSize: 14 }}>Takes {d.takes}</Link>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
