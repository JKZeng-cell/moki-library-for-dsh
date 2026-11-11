import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

// UI state belongs to this workbench window. Keep fetched data, credentials,
// pending operations and confirmation dialogs out of this store. Draft retry
// receipts may be retained as metadata, but restoring them must never send a request.
type PageStateStore = Map<string, unknown>;
const PageStateContext = createContext<PageStateStore | undefined>(undefined);

export function usePageStateCache() { return useContext(PageStateContext); }

export function PageStateProvider({ children }: { children: ReactNode }) {
  const store = useRef<PageStateStore>(new Map());
  return <PageStateContext.Provider value={store.current}>{children}</PageStateContext.Provider>;
}

export function usePageState<T>(key: string | undefined, initial: T | (() => T), preferInitial?: boolean): [T, Dispatch<SetStateAction<T>>];
export function usePageState<T = undefined>(key: string | undefined): [T | undefined, Dispatch<SetStateAction<T | undefined>>];
export function usePageState<T>(key: string | undefined, initial?: T | (() => T), preferInitial = false) {
  const store = useContext(PageStateContext);
  const read = () => !preferInitial && key && store?.has(key)
    ? store.get(key) as T
    : typeof initial === 'function' ? (initial as () => T)() : initial as T;
  const [state, setState] = useState(() => ({ key, value: read() }));
  // A conversation-specific key can change without unmounting its component.
  if (state.key !== key) setState({ key, value: read() });
  useLayoutEffect(() => {
    if (key && state.key === key) store?.set(key, state.value);
  }, [store, key, state]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(update => {
    setState(previous => ({ key, value: typeof update === 'function'
      ? (update as (value: T) => T)(previous.value) : update }));
  }, [key]);
  return [state.value, setValue] as const;
}

export function useRememberedSidebarLocation() {
  const store = useContext(PageStateContext);
  return useCallback((target: string) => {
    const current = new URL(window.location.href);
    // Only navigation coordinates are replayable. In particular, never retain
    // auth callbacks, item-opening commands or settings/confirmation requests.
    const keys = current.pathname === '/tools' ? ['tab']
      : current.pathname === '/whiteboard' ? ['boardId', 'pageId'] : [];
    const query = new URLSearchParams();
    for (const key of keys) {
      const value = current.searchParams.get(key);
      if (value) query.set(key, value);
    }
    if (keys.length) store?.set(`location:${current.pathname}`, `${current.pathname}${query.size ? `?${query}` : ''}`);
    return target.includes('?') || target.includes('#') ? target
      : (store?.get(`location:${target}`) as string | undefined) ?? target;
  }, [store]);
}
