import { l as uiText } from '../../../../../src/i18n.js';
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "lucide-react";
import { IconButton } from "../ui-controls.js";
import "./settings-dialog.css";

export function SettingsDialog({ title, onClose, busy = false, containedScroll = false, suspended = false, parentTitle, footer, className = "", headerAction, children }: {
  title: string; onClose: () => void; busy?: boolean; containedScroll?: boolean; suspended?: boolean; parentTitle?: string; footer?: ReactNode; className?: string; headerAction?: ReactNode; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Capture before sibling layout effects suspend the parent and native close()
  // moves focus to its opener. Reading in our layout effect is already too late.
  const opener = useRef(document.activeElement);
  const lifecycle = useRef(0);
  const hasFooter = footer !== null && footer !== undefined;
  const scrollBody = containedScroll || hasFooter;
  useLayoutEffect(() => {
    const previous = opener.current;
    const node = dialog.current;
    const generation = ++lifecycle.current;
    return () => {
      if (node?.open && typeof node.close === "function") node.close();
      const restore = () => {
        if (generation !== lifecycle.current || !(previous instanceof HTMLElement) || !previous.isConnected || previous.closest('[hidden],[inert],[aria-hidden="true"]')) return;
        previous.focus({ preventScroll: true });
      };
      // A parent may still be suspended during child cleanup. Restore after its
      // layout effect has reopened it, without resetting its scroll position.
      if (parentTitle || previous instanceof HTMLElement && previous.closest('[data-settings-dialog-suspended="true"]')) requestAnimationFrame(restore);
      else restore();
    };
  }, []);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (suspended) {
      const current = document.activeElement;
      if (node.open && typeof node.close === "function") node.close();
      else node.removeAttribute("open");
      // Native close() can restore the parent's opener after a child has
      // already opened. Preserve the active child instead of stealing focus.
      if (current instanceof HTMLElement && current !== document.body && !node.contains(current) && current.isConnected && !current.closest('[hidden],[inert],[aria-hidden="true"]')) current.focus({ preventScroll: true });
    } else if (typeof node.showModal === "function") {
      if (!node.open) node.showModal();
    } else node.setAttribute("open", "");
  }, [suspended]);
  const close = () => { if (!busy && !suspended) onClose(); };
  return createPortal(
    <dialog ref={dialog} role="dialog" tabIndex={-1} hidden={suspended} aria-hidden={suspended || undefined} aria-modal={suspended ? undefined : true} aria-label={title} aria-busy={busy || undefined} data-settings-dialog-suspended={suspended ? "true" : undefined} data-settings-dialog-footer={hasFooter ? "true" : undefined} data-outside-dismiss={busy || suspended ? "false" : undefined} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close(); }}
      onKeyDown={(event) => {
        // Portaled child events also bubble through their React parent dialog.
        if (suspended || !event.currentTarget.contains(event.target as Node) || event.key !== 'Tab' || event.defaultPrevented || event.nativeEvent.isComposing) return;
        const node=event.currentTarget;
        const targets=Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')).filter(element=>element.tabIndex>=0&&!element.closest('[hidden],[inert],[aria-hidden="true"]')&&element.getClientRects().length>0);
        const first=targets[0],last=targets.at(-1),active=document.activeElement;
        if(!first||active===node||(event.shiftKey?active===first:active===last)){event.preventDefault();(event.shiftKey?last??node:first??node).focus();}
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy || suspended) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      className={`moki-settings-dialog moki-ui-dialog m-auto w-[calc(100%-32px)] max-w-3xl p-0 backdrop:bg-[#242a40]/35 backdrop:backdrop-blur-sm ${containedScroll ? "flex h-[calc(100dvh-64px)] max-h-[860px] flex-col overflow-hidden" : "max-h-[calc(100dvh-40px)] overflow-y-auto"} ${className}`}>
      <header className={`moki-dialog-header moki-settings-dialog-header ${scrollBody ? "flex-none" : "sticky top-0"} z-10 flex items-center justify-between gap-4 border-b border-[#e7e9f2] bg-white px-5 py-4`}>
        {parentTitle ? <div className="moki-settings-dialog-heading"><IconButton aria-label={uiText`返回${parentTitle}`} disabled={busy || suspended} onClick={close} className="moki-settings-dialog-back"><ArrowLeft size={16} aria-hidden="true" /></IconButton><h2 className="font-extrabold">{title}</h2></div> : <h2 className="font-extrabold">{title}</h2>}
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {headerAction}
          <IconButton aria-label={uiText`关闭${title}`} disabled={busy || suspended} onClick={close} className="moki-settings-dialog-close"><X size={16} /></IconButton>
        </div>
      </header>
      <div data-settings-dialog-scroll={scrollBody ? "true" : undefined} className={`moki-settings-dialog-body ${scrollBody ? "min-h-0 flex-1 overflow-y-auto p-5" : "p-5"}`}>{children}</div>
      {hasFooter ? <footer className="moki-settings-dialog-footer">{footer}</footer> : null}
    </dialog>, document.body,
  );
}
