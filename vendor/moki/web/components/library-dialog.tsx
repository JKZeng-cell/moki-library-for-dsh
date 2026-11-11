import { useLayoutEffect, useRef, type ReactNode } from "react";

export function LibraryDialog({ titleId, onDismiss, size, children }: {
  titleId: string;
  onDismiss: () => void;
  size?: "small" | "medium";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="dsh-modal" data-size={size} aria-labelledby={titleId} aria-modal="true"
    onCancel={event => { event.preventDefault(); onDismiss(); }}>{children}</dialog>;
}
