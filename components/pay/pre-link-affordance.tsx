'use client';

/**
 * PreLinkAffordance — wallet-to-Telegram binding affordance for the
 * /pay/success page.
 *
 * Three visual states:
 *
 *   1. Anonymous purchase (no SIWS session, no TG link known) →
 *      do not render. The grant-handoff card is the only path; this
 *      component returns null.
 *
 *   2. Pre-linked wallet (SIWS session active AND the subscription
 *      carries `telegram_user_id`) → render an "Access already linked
 *      to your Telegram" panel with the obfuscated TG identifier (or
 *      username if surfaced) instead of the grant-handoff card. The
 *      bot already knows about the subscription via the binding flow
 *      described in `docs/rfc/v0.2.0/wallet-telegram-binding.md` §6.
 *
 *   3. SIWS-bound user with no TG link yet → render a soft CTA
 *      "Already use Vizzor in Telegram? Link your wallet" that opens
 *      a modal explaining the `/link wallet` bot command flow. The
 *      modal is purely informational in v0.2.0; the actual link
 *      handshake lives in the bot.
 *
 * Auth state is fetched via SWR from `/api/auth/session` (existing
 * v0.1.0 endpoint, extended by C2 to surface `telegramUserId` and
 * optional `telegramUsername` when the wallet appears in `wallet_links`).
 *
 * Accessibility:
 *   - The modal uses native semantics: `role="dialog"`, `aria-modal`,
 *     a focused close button on mount, and an Escape key handler.
 *   - Focus returns to the invoking CTA on close.
 *   - Body scroll lock while open.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Link2, ShieldCheck, X } from 'lucide-react';

/**
 * v0.2.0 contract: `/api/auth/session` will surface the optional
 * `telegramUserId` (and possibly `telegramUsername`) once C2's
 * binding work lands. Until then, both fields are `undefined` and
 * this component renders state (3) "link your wallet" CTA for any
 * SIWS-signed user.
 */
interface AuthSessionPayload {
  ok: boolean;
  signedIn: boolean;
  wallet?: string;
  expiresAt?: number;
  telegramUserId?: number | null;
  telegramUsername?: string | null;
  subscription?: {
    tier: string;
    cadence: string;
    expiresAt: number | null;
    isLifetime: boolean;
    /** Surfaced by C2 alongside subscription. */
    telegramUserId?: number | null;
    telegramUsername?: string | null;
  } | null;
}

const fetcher = async (url: string): Promise<AuthSessionPayload> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  return (await res.json()) as AuthSessionPayload;
};

interface PreLinkAffordanceProps {
  /**
   * Render mode:
   *   'inline' → above the grant-handoff card (default on /pay/success).
   *   'replacement' → callers that want to suppress the grant card
   *     entirely when state (2) applies. The page is responsible for
   *     reading `getLinkState()` and rendering accordingly; this
   *     component just rasterizes its slot.
   */
  variant?: 'inline' | 'replacement';
}

type LinkState =
  | { kind: 'anonymous' }
  | { kind: 'linked'; handle: string }
  | { kind: 'siws-no-link' };

/**
 * Pure derivation of the link state from an auth payload. Exported
 * for callers (e.g. the /pay/success page) that need to decide
 * whether to render the grant card at all.
 */
export function deriveLinkState(
  payload: AuthSessionPayload | undefined,
): LinkState {
  if (!payload?.signedIn) return { kind: 'anonymous' };

  // C2 surfaces telegram_user_id on the subscription. Prefer that;
  // fall back to the top-level field if the binding lookup populates
  // it on the auth session row instead.
  const sub = payload.subscription ?? null;
  const tgUserId =
    sub?.telegramUserId ?? payload.telegramUserId ?? null;
  const tgUsername =
    sub?.telegramUsername ?? payload.telegramUsername ?? null;

  if (tgUserId !== null && tgUserId !== undefined) {
    const handle = tgUsername
      ? `@${tgUsername}`
      : `Telegram ID ${tgUserId}`;
    return { kind: 'linked', handle };
  }
  return { kind: 'siws-no-link' };
}

export function PreLinkAffordance({
  variant: _variant = 'inline',
}: PreLinkAffordanceProps) {
  const t = useTranslations('pay.prelink');
  const { data } = useSWR<AuthSessionPayload>(
    '/api/auth/session',
    fetcher,
    { revalidateOnFocus: false },
  );
  const [modalOpen, setModalOpen] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);

  const linkState = deriveLinkState(data);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => {
    setModalOpen(false);
    // Restore focus to the invoking CTA.
    queueMicrotask(() => ctaRef.current?.focus());
  }, []);

  if (linkState.kind === 'anonymous') return null;

  if (linkState.kind === 'linked') {
    return (
      <div
        className="border border-[var(--border)] bg-[var(--surface)] px-4 py-3 flex items-start gap-3"
        role="status"
        aria-live="polite"
      >
        <span className="flex-none pt-0.5 text-[var(--accent)]" aria-hidden>
          <ShieldCheck size={16} strokeWidth={2} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent)]">
            {t('linkedLabel')}
          </p>
          <p className="text-[12.5px] text-[var(--fg-2)] leading-relaxed">
            {t('linked', { handle: linkState.handle })}
          </p>
        </div>
      </div>
    );
  }

  // siws-no-link
  return (
    <>
      <div className="border border-[var(--border)] bg-[var(--surface)] px-4 py-3 flex items-start gap-3">
        <span className="flex-none pt-0.5 text-[var(--fg-2)]" aria-hidden>
          <Link2 size={16} strokeWidth={2} />
        </span>
        <div className="flex flex-col gap-2 flex-1">
          <p className="text-[12.5px] text-[var(--fg-2)] leading-relaxed">
            {t('cta')}
          </p>
          <button
            ref={ctaRef}
            type="button"
            onClick={openModal}
            className="
              self-start inline-flex items-center justify-center gap-1.5 h-9 px-3
              mono tabular text-[10.5px] uppercase tracking-[0.14em]
              border border-[var(--fg)] bg-transparent text-[var(--fg)]
              hover:bg-[var(--fg)] hover:text-[var(--bg)] transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
            "
          >
            <Link2 size={12} strokeWidth={2} aria-hidden />
            <span>{t('ctaButton')}</span>
          </button>
        </div>
      </div>
      {modalOpen && <LinkModal onClose={closeModal} />}
    </>
  );
}

/* ────────────── modal ────────────── */

function LinkModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('pay.prelink');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Body scroll lock + initial focus + Escape handler.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prelink-modal-title"
      aria-describedby="prelink-modal-body"
    >
      {/* Backdrop. Click-to-close is intentional + standard. */}
      <button
        type="button"
        aria-label={t('modalCloseAria')}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        className="
          relative z-10 w-full max-w-[480px]
          border border-[var(--border)] bg-[var(--surface)]
          p-6 flex flex-col gap-4
        "
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="prelink-modal-title"
            className="display text-[20px] font-semibold tracking-tight text-[var(--fg)]"
          >
            {t('modalTitle')}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('modalCloseAria')}
            className="
              inline-flex items-center justify-center
              h-9 w-9 border border-[var(--border)] bg-[var(--surface)]
              hover:bg-[var(--surface-2)] transition-colors text-[var(--fg-2)]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
            "
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <p
          id="prelink-modal-body"
          className="text-[13px] leading-relaxed text-[var(--fg-2)]"
        >
          {t('modalBody')}
        </p>
        <div className="border-t border-[var(--border)] pt-4 flex flex-col gap-2">
          <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
            {t('modalCommandLabel')}
          </p>
          <code
            className="
              mono tabular text-[13px]
              bg-[var(--surface-2)] border border-[var(--border)]
              px-3 py-2 text-[var(--fg)]
            "
          >
            {t('botCommand')}
          </code>
        </div>
      </div>
    </div>
  );
}
