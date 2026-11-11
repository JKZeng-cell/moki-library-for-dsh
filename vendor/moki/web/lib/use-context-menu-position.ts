import { useLayoutEffect, type RefObject } from "react";

/** Place a menu using rendered client pixels, then convert back to its own
 * (possibly zoomed/portaled) coordinate space. Never estimate item heights. */
export function useContextMenuPosition(
  ref: RefObject<HTMLDivElement | null>,
  anchor: { x: number; y: number } | undefined,
): void {
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu || !anchor) return;
    const surface = menu.closest<HTMLElement>(".desktop-shell-surface, .moki-assistant-detached-surface");
    const update = () => {
      const frame = surface?.getBoundingClientRect();
      const usableFrame = frame && frame.width > 0 && frame.height > 0 ? frame : undefined;
      const titlebar = surface?.querySelector<HTMLElement>(".desktop-window-titlebar")?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = Math.max(viewport?.offsetLeft ?? 0, usableFrame?.left ?? 0) + 8;
      const top = Math.max(viewport?.offsetTop ?? 0, usableFrame?.top ?? 0, titlebar?.bottom ?? 0) + 8;
      const right = Math.min((viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth), usableFrame?.right ?? window.innerWidth) - 8;
      const bottom = Math.min((viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight), usableFrame?.bottom ?? window.innerHeight) - 8;
      menu.style.left = "0px";
      menu.style.top = "0px";
      // The shared entrance animation scales/translates the menu. Measure its
      // final box, not an animation frame that will grow past the boundary.
      const transform = menu.style.getPropertyValue("transform");
      const priority = menu.style.getPropertyPriority("transform");
      menu.style.setProperty("transform", "none", "important");
      const initial = menu.getBoundingClientRect();
      const scale = menu.offsetWidth && initial.width ? initial.width / menu.offsetWidth : 1;
      menu.style.maxWidth = `${Math.max(0, right - left) / scale}px`;
      menu.style.maxHeight = `${Math.max(0, bottom - top) / scale}px`;
      const measured = menu.getBoundingClientRect();
      const x = Math.max(left, Math.min(anchor.x, right - measured.width));
      const y = Math.max(top, Math.min(anchor.y, bottom - measured.height));
      menu.style.left = `${(x - measured.left) / scale}px`;
      menu.style.top = `${(y - measured.top) / scale}px`;
      if (transform) menu.style.setProperty("transform", transform, priority);
      else menu.style.removeProperty("transform");
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(menu);
    if (surface) observer?.observe(surface);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer?.disconnect();
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [ref, anchor]);
}
