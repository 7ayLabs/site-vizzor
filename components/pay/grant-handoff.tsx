'use client';

/**
 * GrantHandoff — success card with the one-time grant code and the
 * Telegram redemption affordances.
 *
 * Three handoff paths share one card:
 *   1. Primary CTA "Open Telegram" — deep-link click; opens the
 *      `/start` flow with the grant code attached when Telegram is
 *      installed.
 *   2. Copy-to-clipboard for the standalone code, in case the user
 *      wants to paste it on a different device.
 *   3. QR code rendering of the same deep-link, for the common
 *      cross-device case: paid on desktop, redeem on phone.
 *
 * A "Reopen link" affordance restarts the deep-link click for cases
 * where the OS protocol handler didn't fire on the first attempt.
 *
 * Visual treatment: neutral surface (no accent glow) so the success
 * state reads as calm completion rather than alarming highlight. The
 * `SubscriptionUnlocked` eyebrow + check icon carry the accent color
 * — the rest of the card is `var(--surface)` on `var(--border)`.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  QrCode,
  RotateCcw,
  Send,
} from 'lucide-react';
import QRCode from 'qrcode';

interface GrantHandoffProps {
  code: string;
}

const COPY_FEEDBACK_MS = 1800;

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

  const startPayload = code.startsWith('g_') ? code : `g_${code}`;
  const deepLink = `https://t.me/${BOT_USERNAME}?start=${startPayload}`;

  useEffect(() => {
    copyButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!qrOpen) return;
    if (qrDataUrl !== null) return;
    let cancelled = false;
    QRCode.toDataURL(deepLink, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 224,
      color: { dark: '#0d0e10', light: '#ffffff' },
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
      // Clipboard policy can deny — visible code remains readable.
    }
  };

  const onTryAgain = (): void => {
    deepLinkRef.current?.click();
  };

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded-2xl p-6 flex flex-col gap-5">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_oklab,var(--accent)_15%,transparent)] text-[var(--accent)]"
        >
          <CheckCircle2 size={18} strokeWidth={2.2} />
        </span>
        <div className="flex flex-col gap-1.5 min-w-0">
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--accent)]">
            {t('label')}
          </p>
          <h2 className="text-[20px] sm:text-[22px] font-semibold tracking-tight text-[var(--fg)] leading-tight">
            {t('title')}
          </h2>
          <p className="text-[13px] leading-relaxed text-[var(--fg-2)] max-w-[52ch]">
            {t('body')}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <a
          ref={deepLinkRef}
          href={deepLink}
          target="_blank"
          rel="noopener"
          className="
            group inline-flex items-center justify-center gap-2 h-11 px-4
            rounded-xl bg-[var(--fg)] text-[var(--bg)]
            text-[13px] font-semibold tracking-tight
            transition-[transform,opacity] duration-200 ease-out
            motion-safe:hover:-translate-y-[1px] hover:opacity-95
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
          "
        >
          <Send size={14} strokeWidth={2.2} aria-hidden />
          <span>{t('openTelegram')}</span>
          <ArrowUpRight
            size={14}
            strokeWidth={2.2}
            aria-hidden
            className="transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
          />
        </a>
        <button
          type="button"
          onClick={onTryAgain}
          className="
            inline-flex items-center justify-center gap-1.5 h-11 px-3
            rounded-xl border border-[var(--border)] bg-[var(--surface)]
            text-[12px] font-medium text-[var(--fg-2)]
            hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
          "
        >
          <RotateCcw size={13} strokeWidth={2} aria-hidden />
          <span>{t('tryAgain')}</span>
        </button>
      </div>

      <div className="border-t border-[var(--border)] pt-4 flex flex-col gap-2">
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
          {t('codeLabel')}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 mono tabular text-[12.5px] rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] truncate">
            {startPayload}
          </code>
          <button
            ref={copyButtonRef}
            type="button"
            onClick={onCopy}
            aria-label={copied ? t('copied') : t('copyCode')}
            title={copied ? t('copied') : t('copyCode')}
            className="
              inline-flex items-center justify-center gap-1.5
              h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]
              text-[11.5px] font-medium text-[var(--fg-2)]
              hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
            "
          >
            {copied ? (
              <Check size={13} strokeWidth={2.4} aria-hidden />
            ) : (
              <Copy size={13} strokeWidth={2} aria-hidden />
            )}
            <span>{copied ? t('copied') : t('copyCode')}</span>
          </button>
        </div>
        <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
          {t('codeTtl')}
        </p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {copied ? t('copied') : ''}
        </p>
      </div>

      <div className="border-t border-[var(--border)] pt-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
            {t('qrLabel')}
          </p>
          <button
            type="button"
            onClick={() => setQrOpen((v) => !v)}
            aria-expanded={qrOpen}
            aria-controls="grant-handoff-qr"
            className="
              hidden md:inline-flex items-center justify-center gap-1.5
              h-8 px-2.5 rounded-md
              mono tabular text-[10.5px] uppercase tracking-[0.16em]
              text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
              transition-colors
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
        className="h-[224px] w-[224px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] grid place-items-center"
        aria-hidden
      >
        <span className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
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
        width={224}
        height={224}
        className="rounded-lg border border-[var(--border)] bg-white motion-reduce:transition-none"
      />
    </div>
  );
}
