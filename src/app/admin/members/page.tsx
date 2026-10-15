import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { MemberTools } from './MemberTools';

export default async function MembersPage() {
  const supabase = await supabaseServer();
  const { data: role } = await supabase.rpc('my_role');
  if (role !== 'admin') notFound();
  const [{ data: log }, { data: staff }] = await Promise.all([
    supabase.rpc('admin_recent_log', { p_limit: 50 }),
    supabase.from('profiles').select('handle, role').neq('role', 'member').order('role'),
  ]);
  return (
    <div className="stack" style={{ gap: 28 }}>
      <MemberTools staff={staff ?? []} />
      <section className="stack">
        <h2 className="display d-m">Recent admin actions</h2>
        <div className="card" style={{ padding: '6px 16px' }}>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>When (WAT)</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
              <tbody>
                {(log ?? []).map((l: any, i: number) => (
                  <tr key={i}>
                    <td className="cap">{new Date(l.at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}</td>
                    <td>@{l.who ?? 'former'}</td><td>{l.action.replace(/_/g, ' ')}</td>
                    <td className="cap" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{JSON.stringify(l.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
