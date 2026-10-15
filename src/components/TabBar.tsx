'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';

const TABS = [
  ['/today', 'Today', 'home'],
  ['/knowball', 'Know Ball', 'q'],
  ['/callit', 'Call It', 'target'],
  ['/takes', 'Takes', 'chat'],
  ['/table', 'Table', 'trophy'],
] as const;

/** Bottom tab bar on phones, for members. */
export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Main" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
      {TABS.map(([href, label, icon]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? 'on' : undefined} aria-current={path.startsWith(href) ? 'page' : undefined}>
          <Icon name={icon} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function NavLinks({ member }: { member: boolean }) {
  const path = usePathname();
  const links = member
    ? [['/today', 'Today'], ['/knowball', 'Know Ball'], ['/callit', 'Call It'], ['/takes', 'Cold Takes'], ['/table', 'The Table'], ['/leagues', 'Leagues']]
    : [['/how', 'How it works'], ['/takes', 'Cold Takes'], ['/table', 'The Table']];
  return (
    <nav className="links" aria-label="Main">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? 'on' : undefined} aria-current={path.startsWith(href) ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
