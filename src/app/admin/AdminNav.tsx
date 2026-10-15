'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AdminNav({ role }: { role: string }) {
  const path = usePathname();
  const content = role === 'editor' || role === 'admin';
  const moderate = role === 'steward' || role === 'admin';
  const links: [string, string][] = [
    ['/admin', 'Overview'],
    ...(content ? ([['/admin/quiz', 'Know Ball'], ['/admin/poll', 'Polls'], ['/admin/takes', 'Takes & videos']] as [string, string][]) : []),
    ...(moderate ? ([['/admin/moderation', 'Moderation']] as [string, string][]) : []),
    ...(role === 'admin' ? ([['/admin/members', 'Members & log']] as [string, string][]) : []),
  ];
  return (
    <nav className="adm-nav" aria-label="Admin">
      {links.map(([href, label]) => {
        const on = href === '/admin' ? path === '/admin' : path.startsWith(href);
        return <Link key={href} href={href} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>{label}</Link>;
      })}
    </nav>
  );
}
