'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

const ROLES = [['member', 'Member'], ['steward', 'Steward (moderation)'], ['editor', 'Editor (content)'], ['admin', 'Admin (everything)']];

export function MemberTools({ staff }: { staff: { handle: string; role: string }[] }) {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState('steward');
  const [pHandle, setPHandle] = useState('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const explain = (m: string) => m.includes('not_found') ? 'No member has that handle.'
    : m.includes('cannot_change_own_role') ? "You can't change your own role."
    : m.includes('reason_required') ? 'Give a reason; it goes in the log.'
    : m.includes('bad_points') ? 'Corrections are between -100 and 100, and not zero.'
    : 'That failed. Try again.';

  async function setRoleNow(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('admin_set_role', { p_handle: handle.replace('@', ''), p_role: role });
    setMsg(error ? { ok: false, text: explain(error.message) } : { ok: true, text: `@${handle.replace('@', '')} is now ${role}.` });
    if (!error) { setHandle(''); router.refresh(); }
  }
  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('admin_adjust_points', { p_handle: pHandle.replace('@', ''), p_points: Number(points), p_reason: reason });
    setMsg(error ? { ok: false, text: explain(error.message) } : { ok: true, text: 'Points corrected and logged.' });
    if (!error) { setPHandle(''); setPoints(''); setReason(''); router.refresh(); }
  }

  return (
    <div className="grid2">
      <form className="card stack" onSubmit={setRoleNow}>
        <h1 className="display d-s">Team roles</h1>
        <p className="cap">Current team: {staff.length ? staff.map((s) => `@${s.handle} (${s.role})`).join(', ') : 'just you'}.</p>
        <input className="input" placeholder="Handle, e.g. steward_one" value={handle} onChange={(e) => setHandle(e.target.value)} required aria-label="Handle" />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn ghost">Set role</button>
      </form>
      <form className="card stack" onSubmit={adjust}>
        <h2 className="display d-s">Correct points</h2>
        <p className="cap">For a scoring mistake or after an actioned fair-play flag. Goes into the current matchweek and the log.</p>
        <input className="input" placeholder="Handle" value={pHandle} onChange={(e) => setPHandle(e.target.value)} required aria-label="Handle" />
        <input className="input" placeholder="Points, e.g. -5 or 3" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ''))} required aria-label="Points" />
        <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required aria-label="Reason" />
        <button className="btn ghost">Correct points</button>
      </form>
      {msg && <p className={msg.ok ? 'ok' : 'err'} role="status" style={{ gridColumn: '1 / -1' }}>{msg.text}</p>}
    </div>
  );
}
