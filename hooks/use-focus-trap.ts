'use client';

/**
 * useFocusTrap — minimal, dependency-free focus trap.
 *
 * Designed for modal-style surfaces (alert dialogs, settings sheets,
 * confirmation modals). When `active` is true, the hook:
 *
 *   1. Captures the element that owned focus at activation time (or
 *      uses the caller-provided `returnFocusTo`) so it can be restored.
 *   2. Moves focus to the first tabbable descendant of `ref.current`
 *      on the next animation frame — late enough to survive React's
 *      mount transition, but before the user can press Tab.
 *   3. Installs a `keydown` listener that intercepts Tab / Shift+Tab
 *      and cycles focus through the descendant tabbable set (the
 *      classic A11Y modal trap pattern).
 *   4. Installs a `focusin` listener on the document so focus that
 *      escapes the container (programmatically or via assistive tech)
 *      is pulled back to the first tabbable element. This belt-and-
 *      suspenders pairing with the Tab interceptor matches the trap
 *      semantics expected of `aria-modal="true"` surfaces.
 *   5. On unmount or when `active` flips to false, restores focus to
 *      the previously focused element.
 *
 * When `active` is false the hook is a no-op — no listeners installed,
 * no focus movement. The caller controls when the trap arms.
 *
 * The "tabbable" set is computed via a CSS selector covering the well-
 * known interactive elements, filtered to exclude items that are
 * disabled, `tabindex="-1"`, hidden, or inside a `[hidden]` ancestor.
 * Good enough for our modal use cases without pulling in `tabbable` or
 * `react-focus-lock`.
 */

import { useEffect, type RefObject } from 'react';

/** CSS selector matching the elements that can receive keyboard focus. */
const TABBABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false;
  // `offsetParent` is null for `display: none` and detached nodes.
  // `getClientRects()` covers the `visibility: hidden` and zero-size
  // cases that `offsetParent` misses.
  if (el.offsetParent === null && el.tagName !== 'BODY') return false;
  return el.getClientRects().length > 0;
}

function getTabbable(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR);
  const out: HTMLElement[] = [];
  for (const node of nodes) {
    if (node.getAttribute('aria-hidden') === 'true') continue;
    if (!isVisible(node)) continue;
    out.push(node);
  }
  return out;
}

/**
 * Traps keyboard focus inside `ref.current` while `active` is true.
 *
 * @param ref            ref to the element whose subtree owns focus
 * @param active         enables the trap when true; no-op when false
 * @param returnFocusTo  optional override for where focus should land
 *                       on deactivation. Defaults to the previously
 *                       focused element captured at activation time.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  returnFocusTo?: HTMLElement | null,
): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    if (typeof document === 'undefined') return;

    const previouslyFocused =
      returnFocusTo ?? (document.activeElement as HTMLElement | null);

    // Focus the first tabbable element after the container has had a
    // chance to mount + run its entrance animation. rAF (not 0ms
    // timeout) keeps the move synchronized with the browser's next
    // paint so screen readers announce the heading-then-focus order
    // consistently.
    const focusFrame = window.requestAnimationFrame(() => {
      const tabbables = getTabbable(container);
      const target = tabbables[0] ?? container;
      // If the container itself receives focus, ensure it's focusable.
      // We don't mutate tabindex on tabbable descendants.
      if (target === container && !container.hasAttribute('tabindex')) {
        container.setAttribute('tabindex', '-1');
      }
      target.focus({ preventScroll: false });
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const tabbables = getTabbable(container);
      if (tabbables.length === 0) {
        // Nothing tabbable — keep focus on the container itself so
        // Tab can't escape into the document behind the modal.
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      if (!first || !last) return;
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
        return;
      }
      if (current === last || !container.contains(current)) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (container.contains(target)) return;
      // Focus escaped (programmatically or via assistive tech) —
      // pull it back to the first tabbable.
      const tabbables = getTabbable(container);
      const next = tabbables[0] ?? container;
      next.focus({ preventScroll: true });
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      // Restore focus to the element that owned it before the trap
      // armed. Guard against the element having been removed from the
      // DOM in the meantime (e.g. the trigger was conditionally
      // rendered) — `focus()` on a detached node is a no-op but the
      // `isConnected` check makes intent explicit.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: false });
      }
    };
  }, [active, ref, returnFocusTo]);
}
