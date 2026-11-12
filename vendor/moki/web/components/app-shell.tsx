import type { HTMLAttributes, ReactNode } from 'react';
export function AppShell({ children, fitMainContent: _fit, hideMainScrollbar: _hide, ...events }: HTMLAttributes<HTMLElement> & { children: ReactNode; fitMainContent?: boolean; hideMainScrollbar?: boolean }) {
  return <main className="dsh-library-workspace" {...events}><div className="dsh-library-content">{children}</div></main>;
}
