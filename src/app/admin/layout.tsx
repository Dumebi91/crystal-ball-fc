import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { AdminNav } from './AdminNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin', robots: { index: false } };

/** Only editors, stewards and admins get in; everyone else sees a 404. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: role } = await supabase.rpc('my_role');
  if (!['editor', 'steward', 'admin'].includes(role)) notFound();
  return (
    <div className="wrap page">
      <p className="eyebrow" style={{ marginBottom: 8 }}>Admin · signed in as {role}</p>
      <AdminNav role={role} />
      {children}
    </div>
  );
}
