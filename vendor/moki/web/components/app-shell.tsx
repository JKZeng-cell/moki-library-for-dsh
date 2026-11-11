import type { ReactNode } from 'react';
export function AppShell({ children }: { children: ReactNode; fitMainContent?: boolean; hideMainScrollbar?: boolean }) {
  return <main className="dsh-library-workspace">{children}</main>;
}
