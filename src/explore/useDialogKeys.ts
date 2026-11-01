import { useEffect, useRef } from "react";
/** Keep keyboard focus inside the active source/alignment dialog and restore it on close. */
export function useDialogKeys(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const nodes = [
        ...ref.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ].filter((n) => n.getClientRects().length);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          !ref.current.contains(document.activeElement))
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          !ref.current.contains(document.activeElement))
      ) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key, true);
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    return () => {
      window.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, []);
  return ref;
}
