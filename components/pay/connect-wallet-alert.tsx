'use client';

/**
 * ConnectWalletAlert — modal-style notice that pops when the user
 * tries to pay without a connected wallet.
 *
 * The alert anchors visual attention back to the wallet picker
 * panel and gives the user an obvious next step. Three actions:
 *   - "Connect wallet" → opens the standard Wallet Adapter modal so
 *     the user can pick from every detected Wallet-Standard adapter
 *   - "View installed" → scrolls the inline WalletPickerPanel into
 *     view (handy on mobile where the picker may be off-screen)
 *   - "Cancel" → dismisses
 *
 * Built on the same portal + phase-machine pattern as
 * wallet-selector-modal so the entrance/exit animations and a11y
 * wrappers stay consistent across the app.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { AlertCircle, Wallet2, X } from 'lucide-react';

type Phase = 'closed' | 'opening' | 'open' | 'closing';
const EXIT_MS = 180;

interface ConnectWalletAlertProps {
  open: boolean;
  onClose: () => void;
  /** Optional CSS selector to scroll into view when the user clicks "View installed". */
  pickerSelector?: string;
}

export function ConnectWalletAlert({
  open,
  onClose,
  pickerSelector = '#wallet-picker-title',
}: ConnectWalletAlertProps) {
  const t = useTranslations('pay.connectAlert');
  const { setVisible } = useWalletModal();
  const [phase, setPhase] = useState<Phase>('closed');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setPhase((p) => (p === 'closed' || p === 'closing' ? 'opening' : p));
      const id = window.requestAnimationFrame(() =>
        setPhase((p) => (p === 'opening' ? 'open' : p)),
      );
      return () => window.cancelAnimationFrame(id);
    }
    setPhase((p) => (p === 'closed' ? p : 'closing'));
    const id = window.setTimeout(() => setPhase('closed'), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (phase !== 'open' && phase !== 'opening') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  useEffect(() => {
    if (phase === 'closed') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phase]);

  if (!mounted || phase === 'closed') return null;

  const exiting = phase === 'closing';
  const backdropAnim = exiting
    ? 'motion-safe:wallet-modal-fade-out'
    : 'motion-safe:wallet-modal-fade-in';
  const cardAnim = exiting
    ? 'motion-safe:wallet-modal-slide-out'
    : 'motion-safe:wallet-modal-slide-in';

  const openWalletModal = () => {
    setVisible(true);
    onClose();
  };

  const focusPicker = () => {
    onClose();
    window.requestAnimationFrame(() => {
      const el = document.querySelector(pickerSelector);
      if (el && 'scrollIntoView' in el) {
        (el as HTMLElement).scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    });
  };

  const node = (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="connect-wallet-alert-title"
      aria-describedby="connect-wallet-alert-body"
      className={`fixed inset-0 z-[60] flex items-end sm:items-center justify-center ${backdropAnim}`}
    >
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={onClose}
        className="absolute inset-0 bg-[color:color-mix(in_oklab,var(--bg)_70%,black_20%)]/85 backdrop-blur-sm"
      />

      <div
        className={`relative z-10 w-[calc(100%-1.5rem)] sm:max-w-[400px] border border-[var(--border)] bg-[var(--surface)] rounded-2xl shadow-[0_24px_60px_-12px_rgba(0,0,0,0.5)] flex flex-col ${cardAnim}`}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_oklab,var(--accent)_15%,transparent)] text-[var(--accent)]"
          >
            <AlertCircle size={20} strokeWidth={2.2} />
          </span>
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <p className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--accent)]">
              {t('eyebrow')}
            </p>
            <h2
              id="connect-wallet-alert-title"
              className="text-[15px] font-semibold tracking-tight text-[var(--fg)]"
            >
              {t('title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dismiss')}
            className="-mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <p
          id="connect-wallet-alert-body"
          className="px-5 pb-3 text-[12.5px] leading-[1.55] text-[var(--fg-2)]"
        >
          {t('body')}
        </p>

        <div className="flex flex-col gap-1.5 px-5 pb-5">
          <button
            type="button"
            onClick={openWalletModal}
            className="
              group inline-flex h-11 items-center justify-center gap-2
              rounded-xl bg-[var(--accent)] px-4
              text-[12.5px] font-semibold tracking-tight text-[var(--accent-fg)]
              transition-[transform,opacity] duration-200 ease-out
              motion-safe:hover:-translate-y-[1px] hover:opacity-95
            "
          >
            <Wallet2 size={14} strokeWidth={2.2} />
            <span>{t('primary')}</span>
            <span
              aria-hidden
              className="transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5"
            >
              →
            </span>
          </button>
          <button
            type="button"
            onClick={focusPicker}
            className="
              inline-flex h-10 items-center justify-center
              rounded-xl border border-[var(--border)]
              text-[12px] font-medium text-[var(--fg)]
              hover:bg-[var(--surface-2)] transition-colors
            "
          >
            {t('secondary')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="
              inline-flex h-8 items-center justify-center
              text-[11.5px] text-[var(--fg-3)] hover:text-[var(--fg)]
              transition-colors
            "
          >
            {t('dismiss')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
