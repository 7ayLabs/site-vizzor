'use client';

/**
 * LifetimePromoModal — /pricing on-mount lifetime tier promotion.
 *
 * Reuses the patterns from components/auth/wallet-selector-modal.tsx
 * (sibling slice purchase-ux-navbar-modal): portal to document.body,
 * phase machine for clean exit animations, ESC + backdrop close,
 * body-scroll lock, prefers-reduced-motion respect.
 *
 * Driven by usePromoModalTrigger which:
 *   - opens 600ms after /pricing first paint
 *   - suppresses re-opens for 30 days after dismissal via localStorage
 *   - exposes openManually() for the floating re-trigger pill
 *
 * Content emphasises the lifetime tier ($1,249 once) framed against
 * the 10-year monthly equivalent ($5,988) to anchor the savings.
 * Primary CTA routes to /pay/elite/lifetime; secondary just dismisses.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Sparkles, X } from 'lucide-react';

type Phase = 'closed' | 'opening' | 'open' | 'closing';
const EXIT_MS = 200;

interface LifetimePromoModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function LifetimePromoModal({ open, onDismiss }: LifetimePromoModalProps) {
  const t = useTranslations('pricing.promo.lifetime');
  const [phase, setPhase] = useState<Phase>('closed');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Phase machine driven by the controlled `open` prop.
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

  // ESC dismisses while interactive.
  useEffect(() => {
    if (phase !== 'open' && phase !== 'opening') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, onDismiss]);

  // Body-scroll lock while visible.
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
    ? 'motion-safe:promo-modal-fade-out'
    : 'motion-safe:promo-modal-fade-in';
  const cardAnim = exiting
    ? 'motion-safe:promo-modal-slide-out'
    : 'motion-safe:promo-modal-slide-in';

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promo-lifetime-title"
      className={`fixed inset-0 z-[60] flex items-end sm:items-center justify-center ${backdropAnim}`}
    >
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={onDismiss}
        className="absolute inset-0 bg-[color:color-mix(in_oklab,var(--bg)_70%,black_20%)]/85 backdrop-blur-sm"
      />

      <div
        className={`relative z-10 w-[calc(100%-1.5rem)] sm:max-w-[440px] border border-[var(--border)] bg-[var(--surface)] rounded-2xl shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)] flex flex-col ${cardAnim}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-7 pt-6 pb-3">
          <div className="flex flex-col gap-2 min-w-0">
            <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)] inline-flex items-center gap-1.5">
              <Sparkles size={11} strokeWidth={2.4} />
              <span>{t('eyebrow')}</span>
            </p>
            <h2
              id="promo-lifetime-title"
              className="text-[19px] sm:text-[21px] font-semibold tracking-tight text-[var(--fg)] leading-[1.25]"
            >
              {t('title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('dismiss')}
            className="shrink-0 -mr-1.5 -mt-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="px-7 pb-5 flex flex-col gap-4">
          <p className="text-[13px] leading-[1.55] text-[var(--fg-2)]">
            {t('subtitle')}
          </p>

          {/* Savings panel — vertical stack so the prices breathe */}
          <div className="border border-[var(--border)] bg-[var(--bg)]/40 px-4 py-4 flex flex-col gap-3 rounded-xl">
            <div className="flex items-baseline justify-between gap-3">
              <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
                {t('lifetimePriceLabel')}
              </p>
              <p className="mono tabular text-[10px] text-[var(--fg-3)]">
                {t('lifetimePriceCaption')}
              </p>
            </div>
            <p className="text-[28px] font-semibold tracking-tight text-[var(--fg)] leading-none">
              $1,249
            </p>
            <div className="h-px bg-[var(--border)]" />
            <div className="flex items-baseline justify-between gap-3">
              <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
                {t('comparisonLabel')}
              </p>
              <p className="mono tabular text-[10px] text-[var(--fg-3)]">
                {t('comparisonCaption')}
              </p>
            </div>
            <p className="text-[22px] font-medium tracking-tight text-[var(--fg-3)] leading-none line-through">
              $5,988
            </p>
          </div>

          {/* SOL discount footnote */}
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">
            {t('solFootnote')}
          </p>
        </div>

        {/* CTAs */}
        <div className="flex flex-col gap-1.5 px-7 pb-6">
          <Link
            href="/pay/elite/lifetime"
            onClick={onDismiss}
            className="
              inline-flex h-11 items-center justify-center gap-1.5
              rounded-full bg-[var(--accent)] px-5
              text-[12.5px] font-semibold tracking-tight text-[var(--accent-fg)]
              hover:opacity-90 transition-opacity
            "
          >
            <span>{t('cta')}</span>
            <span aria-hidden>→</span>
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="
              inline-flex h-9 items-center justify-center
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

  // Portal to escape the /pricing page's stacking context.
  return createPortal(modal, document.body);
}

/**
 * LifetimeRetriggerPill — small fixed-position button at the bottom
 * of /pricing that re-opens the modal after the user dismissed it.
 * Renders only when the modal is closed AND the controlled state
 * permits manual re-open.
 */
export function LifetimeRetriggerPill({
  visible,
  onOpen,
}: {
  visible: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('pricing.promo.lifetime');
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="
        fixed bottom-5 right-5 z-40
        inline-flex h-10 items-center gap-1.5 rounded-full
        border border-[var(--border)] bg-[var(--surface)] px-3.5
        text-[12px] font-semibold tracking-tight text-[var(--fg)]
        shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)]
        hover:bg-[var(--surface-2)]
        transition-colors
      "
    >
      <Sparkles size={12} strokeWidth={2.4} className="text-[var(--accent)]" />
      <span>{t('retriggerPill')}</span>
    </button>
  );
}
