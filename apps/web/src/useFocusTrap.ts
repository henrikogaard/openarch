
import { useEffect, useRef } from 'react';

/**
 * Trap keyboard focus inside a modal while it is open, and return focus to
 * the previously focused element on close. Usage: <div ref={trapRef}> and
 * useFocusTrap(trapRef, active).
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean): void {
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const container = ref.current;
    if (!container) return;
    const focusables = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    const first = container.querySelector<HTMLElement>(focusables);
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusableElements = [...container.querySelectorAll<HTMLElement>(focusables)];
      if (!focusableElements.length) return;
      const firstEl = focusableElements[0];
      const lastEl = focusableElements[focusableElements.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && (focused === firstEl || focused === container)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && focused === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      restoreRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
