'use client';

/**
 * SubscriptionManagementCard — wallet-aware controls for the user's
 * active subscription on /account.
 *
 * Renders one of three states:
 *   1. Lifetime owner   → a single "non-refundable" line. No buttons.
 *   2. Schedule pending → the green "Plan continues until {date}" banner
 *                         + a quiet undo link (POST /api/subscriptions/cancel
 *                         with scheduledAction=null is currently not
 *                         exposed; the v0.4 product call is "undo
 *                         requires a fresh upgrade", same as the bot).
 *   3. No schedule yet  → "Cancel subscription" and (Elite only)
 *                         "Downgrade to Pro" buttons.
 *
 * Confirmation pattern is inline two-step (no modal): first click
 * arms the action and morphs the label to "Click again to confirm",
 * 5s armed window before auto-reset. Same UX GitHub uses for "delete
 * repository" — keeps the chrome calm without scope-creeping into a
 * modal layer.
 *
 * On success, the component force-reloads `/account` so every other
 * surface (subscription stats tile, /api/quota cache) catches up
 * without separate revalidation plumbing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Check, ShieldCheck, X } from 'lucide-react';

type ScheduledAction = 'cancel' | 'downgrade_to_pro' | null;

interface SubscriptionManagementCardProps {
  tier: string;
  cadence: string;
  expiresAt: number | null;
  isLifetime: boolean;
  scheduledAction: ScheduledAction;
}

const ARM_WINDOW_MS = 5000;

export function SubscriptionManagementCard({
  tier,
  cadence,
  expiresAt,
  isLifetime,
  scheduledAction,
}: SubscriptionManagementCardProps) {
  const t = useTranslations('account.subscription');
  const router = useRouter();
  const [armed, setArmed] = useState<'cancel' | 'downgrade' | null>(null);
  const [busy, setBusy] = useState<'cancel' | 'downgrade' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const armResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-disarm after the 5s window so a stale "armed" button can't
  // silently fire when the user comes back to the tab minutes later.
  const arm = useCallback((which: 'cancel' | 'downgrade') => {
    setArmed(which);
    setError(null);
    if (armResetRef.current) clearTimeout(armResetRef.current);
    armResetRef.current = setTimeout(() => setArmed(null), ARM_WINDOW_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (armResetRef.current) clearTimeout(armResetRef.current);
    };
  }, []);

  const runAction = useCallback(
    async (action: 'cancel' | 'downgrade') => {
      setBusy(action);
      setError(null);
      try {
        const url =
          action === 'cancel'
            ? '/api/subscriptions/cancel'
            : '/api/subscriptions/downgrade';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; reason?: string }
          | null;
        if (!res.ok || !data?.ok) {
          setError(data?.reason ?? `http_${res.status}`);
          setBusy(null);
          setArmed(null);
          return;
        }
        // Hard refresh — the simplest way to fan out the new
        // subscription state to every cached surface (/account stats,
        // /api/quota SWR slot on /pricing, etc).
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown');
        setBusy(null);
        setArmed(null);
      }
    },
    [router],
  );

  // 1. Lifetime — no controls. Single explanatory line.
  if (isLifetime) {
    return (
      <SectionShell title={t('manageTitle')}>
        <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)] inline-flex items-center gap-2">
          <ShieldCheck
            size={14}
            strokeWidth={2}
            className="text-[var(--fg-3)]"
            aria-hidden
          />
          <span>{t('lifetimeCannotChange')}</span>
        </p>
      </SectionShell>
    );
  }

  // 2. Schedule already pending.
  if (scheduledAction) {
    const dateLabel =
      expiresAt !== null
        ? new Date(expiresAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '—';
    const noticeKey =
      scheduledAction === 'cancel'
        ? 'scheduledNotice.cancel'
        : 'scheduledNotice.downgrade';
    return (
      <SectionShell title={t('manageTitle')}>
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)]"
          >
            <Check size={11} strokeWidth={3} />
          </span>
          <p className="text-[13px] leading-relaxed text-[var(--fg)]">
            {fillTemplate(t(noticeKey), { date: dateLabel })}
          </p>
        </div>
      </SectionShell>
    );
  }

  // 3. Active subscription with no schedule yet — show the controls.
  const isElite = tier === 'elite';

  return (
    <SectionShell title={t('manageTitle')}>
      <p className="text-[13px] leading-relaxed text-[var(--fg-3)]">
        {t('manageBody')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <InlineTwoStepButton
          variant="outline"
          armed={armed === 'cancel'}
          busy={busy === 'cancel'}
          label={t('cancel')}
          confirmLabel={t('confirmAgain')}
          busyLabel={t('cancelling')}
          onArm={() => arm('cancel')}
          onConfirm={() => runAction('cancel')}
        />
        {isElite && (
          <InlineTwoStepButton
            variant="outline"
            armed={armed === 'downgrade'}
            busy={busy === 'downgrade'}
            label={t('downgrade')}
            confirmLabel={t('confirmAgain')}
            busyLabel={t('downgrading')}
            onArm={() => arm('downgrade')}
            onConfirm={() => runAction('downgrade')}
          />
        )}
      </div>
      {error && (
        <p className="text-[12px] text-[var(--danger)] inline-flex items-center gap-1.5">
          <X size={12} strokeWidth={2.5} aria-hidden />
          <span>{t('error', { reason: error })}</span>
        </p>
      )}
    </SectionShell>
  );
}

/* ────────────── helpers ────────────── */

function SectionShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--fg)]">
          {title}
        </h2>
      </header>
      {children}
    </section>
  );
}

function InlineTwoStepButton({
  variant,
  armed,
  busy,
  label,
  confirmLabel,
  busyLabel,
  onArm,
  onConfirm,
}: {
  variant: 'outline' | 'danger';
  armed: boolean;
  busy: boolean;
  label: string;
  confirmLabel: string;
  busyLabel: string;
  onArm: () => void;
  onConfirm: () => void;
}) {
  const className = [
    'inline-flex h-9 items-center justify-center gap-1.5 px-3 rounded-lg',
    'mono tabular text-[10.5px] uppercase tracking-[0.16em] font-medium',
    'transition-colors',
    armed
      ? 'border border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)] hover:opacity-90'
      : variant === 'danger'
        ? 'border border-[var(--danger)] bg-[var(--surface)] text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]'
        : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
    'disabled:opacity-50',
  ].join(' ');

  if (busy) {
    return (
      <button type="button" disabled className={className}>
        {busyLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={armed ? onConfirm : onArm}
      className={className}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  // `%name%` delimiter — survives next-intl's ICU parser intact so we
  // can substitute at render time without flagging the placeholder
  // as an unmet ICU value.
  return template.replace(/%(\w+)%/g, (_, key) => vars[key] ?? `%${key}%`);
}
