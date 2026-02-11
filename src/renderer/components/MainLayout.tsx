import React from 'react';
import { useAppStore } from '../store/app-store';

interface MainLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function MainLayout({ sidebar, children }: MainLayoutProps) {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[var(--color-surface)]">
      {/* Sidebar */}
      <aside
        className={`
          flex-shrink-0 bg-[var(--color-sidebar)]
          transition-all duration-300 ease-in-out overflow-hidden
          ${sidebarCollapsed ? 'w-0' : 'w-64'}
        `}
        style={{ borderRight: '1px solid var(--color-border)' }}
      >
        <div className="w-64 h-full overflow-y-auto">{sidebar}</div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
