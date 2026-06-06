'use client';

/**
 * GrantHandoff — success card with the one-time grant code and the
 * Telegram redemption affordances.
 *
 * The card surfaces three ways for the user to complete the handoff
 * to the bot:
 *
 *   1. Primary CTA "Open in Telegram" — a deep-link click that, on a
 *      device with Telegram installed, opens directly into the bot's
 *      `/start` flow with the grant code attached.
 *   2. Copy-to-clipboard for the standalone grant code, in case the
 *      user wants to paste it into a different device (e.g. paid on
 *      desktop, redeems on phone).
 *   3. QR code rendering of the same deep-link, for the common
 *      cross-device case: paid on desktop, scan with the phone's
 *      camera to open Telegram on the device that has it installed.
 *
 * A "Try again" affordance restarts the deep-link in case the
 * Telegram protocol handler didn't fire on the first click (a real
 * problem on iOS Safari when the user just dismissed a deep-link
 * permission prompt).
 *
 * Accessibility:
 *   - The copy button auto-focuses on mount so keyboard users land on
 *     the most likely first action.
 *   - The "Copied" state is announced via aria-live=polite.
 *   - The QR image carries an aria-label naming the deep-link so screen
 *     readers can read its purpose; the link is also present as text.
 *   - `prefers-reduced-motion`: the QR fade-in respects it (no CSS
 *     transition when set), via Tailwind `motion-reduce:` utilities.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Check, QrCode, RefreshCcw, ExternalLink } from 'lucide-react';
import QRCode from 'qrcode';

interface GrantHandoffProps {
  code: string;
}

const COPY_FEEDBACK_MS = 1800;

/**
 * Telegram bot username. Defaults to the production handle but can be
 * overridden at deploy time via NEXT_PUBLIC_TG_BOT_USERNAME, per the
 * v0.2.0 env-var registry (`docs/rfc/v0.2.0/architecture.md` §5).
 */
const BOT_USERNAME =
  process.env.NEXT_PUBLIC_TG_BOT_USERNAME ?? 'vizzorai_bot';

export function GrantHandoff({ code }: GrantHandoffProps) {
  const t = useTranslations('pay.grant');
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const deepLinkRef = useRef<HTMLAnchorElement>(null);

  // Per the wallet-telegram-binding RFC §5, the bot-side start payload
  // is `g_<code>` — the `g_` prefix is part of the grant id minted by
  // `issueGrantForSession`. The route handler stamps the prefix; we
  // do not double-prefix here.
  const startPayload = code.startsWith('g_') ? code : `g_${code}`;
  const deepLink = `https://t.me/${BOT_USERNAME}?start=${startPayload}`;

  // Auto-focus the copy button on mount — keyboard users land on the
  // most likely first action (copy the link to a phone).
  useEffect(() => {
    copyButtonRef.current?.focus();
  }, []);

  // Render the QR exactly once when the disclosure opens. On a small
  // viewport we render it eagerly — see the second effect below.
  useEffect(() => {
    if (!qrOpen) return;
    if (qrDataUrl !== null) return;
    let cancelled = false;
    QRCode.toDataURL(deepLink, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: {
        // The QR has to stay scannable in dark mode. Foreground/back
        // are inverted compared to the page so the camera reads a
        // crisp light-on-dark pattern regardless of theme. Both
        // contrast pairs comfortably exceed WCAG AA.
        dark: '#0d0e10',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
          setQrError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setQrError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [qrOpen, qrDataUrl, deepLink]);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // Clipboard API can fail under iframe/permission-policy. Fall
      // back to selecting the visible code so the user can copy
      // manually. We do not surface an error — the visible code
      // remains readable either way.
    }
  };

  const onTryAgain = (): void => {
    deepLinkRef.current?.click();
  };

  return (
    <div className="border border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)] bg-[var(--surface)] p-6 flex flex-col gap-5">
      <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
        {t('label')}
      </p>

      <div className="flex flex-col gap-2">
        <h2 className="display text-[22px] sm:text-[26px] font-semibold tracking-tight text-[var(--fg)] leading-tight">
          {t('title')}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)] max-w-[48ch]">
          {t('body')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          ref={deepLinkRef}
          href={deepLink}
          target="_blank"
          rel="noopener"
          className="
            inline-flex items-center justify-center gap-2 h-11 px-4
            text-[13px] font-semibold tracking-tight
            bg-[var(--accent)] text-[var(--accent-fg)]
            hover:opacity-90 transition-opacity
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
          "
        >
          <ExternalLink size={14} strokeWidth={2} aria-hidden />
          <span>{t('openTelegram')}</span>
        </a>
        <button
          type="button"
          onClick={onTryAgain}
          className="
            inline-flex items-center justify-center gap-1.5 h-11 px-3
            mono tabular text-[10.5px] uppercase tracking-[0.14em]
            border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)]
            hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
          "
        >
          <RefreshCcw size={13} strokeWidth={2} aria-hidden />
          <span>{t('tryAgain')}</span>
        </button>
      </div>

      <div className="border-t border-[var(--border)] pt-4 flex flex-col gap-2">
        <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
          {t('codeLabel')}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 mono tabular text-[12px] bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] truncate">
            {startPayload}
          </code>
          <button
            ref={copyButtonRef}
            type="button"
            onClick={onCopy}
            aria-label={copied ? t('copied') : t('copyCode')}
            title={copied ? t('copied') : t('copyCode')}
            className="
              inline-flex items-center justify-center
              h-10 w-10 border border-[var(--border)] bg-[var(--surface)]
              hover:bg-[var(--surface-2)] transition-colors text-[var(--fg-2)]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
            "
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          </button>
        </div>
        <p className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {t('codeTtl')}
        </p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {copied ? t('copied') : ''}
        </p>
      </div>

      {/*
        QR disclosure — collapsed by default on >=md (desktop), but
        rendered eagerly via the always-visible block at <=md so
        mobile/cross-device users can scan without an extra click.
       */}
      <div className="border-t border-[var(--border)] pt-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
            {t('qrLabel')}
          </p>
          <button
            type="button"
            onClick={() => setQrOpen((v) => !v)}
            aria-expanded={qrOpen}
            aria-controls="grant-handoff-qr"
            className="
              hidden md:inline-flex items-center justify-center gap-1.5
              mono tabular text-[10px] uppercase tracking-[0.14em]
              text-[var(--fg-3)] hover:text-[var(--fg)]
              underline-offset-4 hover:underline transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
            "
          >
            <QrCode size={12} strokeWidth={2} aria-hidden />
            <span>{qrOpen ? t('qrHide') : t('qrShow')}</span>
          </button>
        </div>

        <div
          id="grant-handoff-qr"
          className={`
            ${qrOpen ? 'block' : 'hidden md:hidden'}
            grid place-items-center
          `}
        >
          <QrSurface
            dataUrl={qrDataUrl}
            error={qrError}
            deepLink={deepLink}
            ariaLabel={t('qrAlt')}
          />
        </div>
        {/* Mobile-first: render QR eagerly under md so users on a
            phone can scan immediately. Suppressed on md+ where the
            disclosure controls visibility. */}
        <div className="md:hidden grid place-items-center">
          <QrSurface
            dataUrl={qrDataUrl}
            error={qrError}
            deepLink={deepLink}
            ariaLabel={t('qrAlt')}
            forceLoad
            onForceLoad={() => {
              if (!qrOpen) setQrOpen(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ────────────── QR rendering surface ────────────── */

interface QrSurfaceProps {
  dataUrl: string | null;
  error: boolean;
  deepLink: string;
  ariaLabel: string;
  /** When true, trigger QR generation via `onForceLoad`. */
  forceLoad?: boolean;
  onForceLoad?: () => void;
}

function QrSurface({
  dataUrl,
  error,
  deepLink,
  ariaLabel,
  forceLoad,
  onForceLoad,
}: QrSurfaceProps) {
  // The mobile-first surface generates the QR even when the
  // disclosure has not been clicked. Defer to onForceLoad so the
  // owning component manages the actual generation state.
  useEffect(() => {
    if (forceLoad && dataUrl === null && !error) {
      onForceLoad?.();
    }
  }, [forceLoad, dataUrl, error, onForceLoad]);

  if (error) {
    return (
      <p className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)] text-center">
        <a
          href={deepLink}
          target="_blank"
          rel="noopener"
          className="underline underline-offset-4 hover:text-[var(--fg)]"
        >
          {deepLink}
        </a>
      </p>
    );
  }
  if (dataUrl === null) {
    return (
      <div
        className="h-[240px] w-[240px] border border-[var(--border)] bg-[var(--surface-2)] grid place-items-center"
        aria-hidden
      >
        <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          …
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt={ariaLabel}
        width={240}
        height={240}
        className="border border-[var(--border)] bg-white motion-reduce:transition-none"
      />
    </div>
  );
}
