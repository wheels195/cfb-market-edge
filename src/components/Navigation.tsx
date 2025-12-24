'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/games', label: 'CFB' },
  { href: '/cbb', label: 'CBB' },
  { href: '/model', label: 'Our Model' },
  { href: '/reports', label: 'Reports' },
];

export function Navigation() {
  const pathname = usePathname();

  // Hide on home page (has its own nav)
  if (pathname === '/') return null;

  return (
    <nav className="bg-[#0a0a0a] border-b border-zinc-800/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="font-mono text-xl font-bold text-white tracking-tight">
              Whodl Bets
            </span>
          </Link>
          <div className="flex items-center space-x-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
