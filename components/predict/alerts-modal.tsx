'use client';

/**
 * AlertsModal — a modal version of the /app/alerts surface mounted
 * directly inside the predict shell.
 *
 * The body intentionally reuses <AlertsList /> verbatim so the
 * armed/triggered/resolved chrome (corner brackets, mono numbers,
 * empty states, snapshot pill) stays identical to the standalone
 * page — no parallel UI to keep in sync.
 *
 * Open/close motion:
 *   - Backdrop fades via `wallet-modal-fade-in/out` (140ms).
 *   - Sheet slides up + scales via `wallet-modal-slide-in/out`
 *     (200/160ms). On close the modal stays MOUNTED for the duration
 *     of the slide-out so the exit animation plays cleanly instead of
 *     snapping to unmount. Under reduced-motion, the global media
 *     query in globals.css collapses both animations.
 *
 * Side effects on open:
 *   1. Requests browser Notification permission once (default state
 *      only — we never re-prompt after the user has answered).
 *   2. Polls /api/alerts every 30s through the same SWR cache the
 *      list uses, so new triggers surface in the banner above the
 *      modal AND fire a desktop notification when permission is
 *      granted.
 *
 * Esc + backdrop close. Renders nothing visually when fully closed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertsList } from '@/components/app/alerts-list';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { cn } from '@/lib/utils';
import { IconClose } from './predict-icons';

export interface AlertsModalProps {
  open: boolean;
  onClose: () => void;
}

/** Slide-out duration in ms — must match the
 *  `wallet-modal-slide-out` keyframe in globals.css. */
const CLOSE_ANIM_MS = 180;

export function AlertsModal({ open, onClose }: AlertsModalProps) {
  const t = useTranslations('app.alerts');

  // `mounted` mirrors `open` but lags behind on close so the exit
  // animation plays before unmount. `closing` flips the className from
  // the slide-IN keyframe to the slide-OUT keyframe for the duration
  // of the timeout.
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Panel ref — trapped while the modal is open AND not in its exit
  // animation, so focus restoration runs while the trigger is still in
  // the document.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(panelRef, open && mounted && !closing);

  useEffect(() => {
    if (open) {
      // Opening — clear any pending close, mount immediately, play
      // the slide-in keyframe.
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    // Closing — flip className to slide-OUT and unmount once the
    // animation has finished.
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setMounted(false);
      setClosing(false);
      closeTimer.current = null;
    }, CLOSE_ANIM_MS);
    return () => {
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [open, mounted]);

  // Ask for desktop-notification permission the first time the modal
  // opens. Browsers ignore repeat requests once the user has answered,
  // so the second-or-later check short-circuits with no UI noise.
  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    Notification.requestPermission().catch(() => {
      // The user dismissed or the browser refused — nothing to do,
      // the banner remains the in-page fallback delivery channel.
    });
  }, [open]);

  // Esc to close. Only armed while the modal is actually visible so
  // a stray Esc during the exit animation doesn't re-fire onClose.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const stop = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
  }, []);

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
    >
      <button
        type="button"
        aria-label={t('modal.close')}
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-black/55 backdrop-blur-sm',
          'motion-safe:will-change-[opacity]',
          closing
            ? 'motion-safe:wallet-modal-fade-out'
            : 'motion-safe:wallet-modal-fade-in',
        )}
      />
      <div
        ref={panelRef}
        onClick={stop}
        className={cn(
          'relative z-10 w-full sm:max-w-[640px]',
          'max-h-[88vh] sm:max-h-[80vh] flex flex-col',
          'rounded-t-2xl sm:rounded-2xl border border-[var(--border)] bg-[var(--surface)]',
          'shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]',
          'motion-safe:will-change-[transform,opacity]',
          closing
            ? 'motion-safe:wallet-modal-slide-out'
            : 'motion-safe:wallet-modal-slide-in',
        )}
      >
        <header className="shrink-0 flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-[var(--border)]/60">
          <h2 className="text-[18px] sm:text-[19px] leading-[1.15] tracking-[-0.018em] font-semibold text-[var(--fg)] truncate">
            {t('title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('modal.close')}
            className={cn(
              '-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full',
              'text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors',
            )}
          >
            <IconClose size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 vz-compact-scroll">
          <AlertsList />
        </div>
      </div>
    </div>
  );
}
