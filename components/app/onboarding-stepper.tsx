'use client';

/**
 * OnboardingStepper — first-run /app/* welcome modal.
 *
 * Auto-opens once per browser (localStorage dismissal flag) when the
 * user isn't yet signed in. Steps:
 *   1. connect      — embed the wallet selector via WalletAuthButton
 *   2. siws         — auto-advance when the wallet adapter completes
 *                     the sign-in flow (handled by useOnboarding's
 *                     external signedIn watcher)
 *   3. trial-intro  — explain the 7-day Pro trial + daily cap
 *   4. done         — close, persist dismissal
 *
 * Skip writes the dismissal flag at any step so a user who closes via
 * Escape or the X button doesn't see it re-open on the next /app/*
 * visit. They can always re-trigger from Cmd+K → "Show onboarding".
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { X, Wallet, ShieldCheck, Sparkles } from 'lucide-react';
import { useAppShell } from './app-shell-provider';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';
import { useOnboarding, type OnboardingPhase } from './use-onboarding';
import { useRegisterOnboardingOpener } from './onboarding-context';

const TRIAL_DAYS = Number.parseInt(
  process.env.NEXT_PUBLIC_FREE_TRIAL_DAYS ?? '7',
  10,
) || 7;
const TRIAL_DAILY_CAP = Number.parseInt(
  process.env.NEXT_PUBLIC_TRIAL_DAILY_CAP ?? '5',
  10,
) || 5;

export function OnboardingStepper() {
  const t = useTranslations('app.onboarding');
  const { session } = useAppShell();
  const signedIn = session?.signedIn === true;
  const { phase, dismiss, advance, setPhase, open } = useOnboarding({ signedIn });
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Make the open() callback discoverable via context so the Cmd+K
  // catalog can re-trigger the modal after a dismissal.
  useRegisterOnboardingOpener(open);

  // Escape closes the modal AND records dismissal (matches the X
  // button behavior — both are intentional dismissals).
  useEffect(() => {
    if (phase === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [phase, dismiss]);

  if (!mounted || phase === 'closed') return null;

  const body: Record<Exclude<OnboardingPhase, 'closed'>, ReactNode> = {
    connect: (
      <StepShell
        icon={<Wallet size={28} strokeWidth={1.5} />}
        eyebrow={t('connect.eyebrow')}
        title={t('connect.title')}
        body={t('connect.body')}
        primary={
          <div className="flex justify-center">
            <WalletAuthButton hasProvider={true} useModal={true} />
          </div>
        }
        skip={t('connect.skip')}
        onSkip={dismiss}
      />
    ),
    siws: (
      <StepShell
        icon={<ShieldCheck size={28} strokeWidth={1.5} />}
        eyebrow={t('siws.eyebrow')}
        title={t('siws.title')}
        body={t('siws.body')}
        primary={
          <p className="text-[12.5px] text-[var(--fg-3)] italic">
            {t('siws.waiting')}
          </p>
        }
        skip={t('siws.skip')}
        onSkip={dismiss}
      />
    ),
    'trial-intro': (
      <StepShell
        icon={<Sparkles size={28} strokeWidth={1.5} />}
        eyebrow={t('trialIntro.eyebrow')}
        title={t('trialIntro.title', { days: TRIAL_DAYS })}
        body={t('trialIntro.body', { dailyCap: TRIAL_DAILY_CAP })}
        primary={
          <button
            type="button"
            onClick={() => {
              setPhase('done');
              dismiss();
            }}
            className="
              inline-flex h-10 items-center justify-center px-5
              rounded-full bg-[var(--fg)] text-[var(--bg)]
              text-[13px] font-semibold tracking-tight
              hover:opacity-90 transition-opacity
            "
          >
            {t('trialIntro.cta')}
          </button>
        }
        skip={undefined}
        onSkip={dismiss}
      />
    ),
    done: <></>,
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('aria.dialog')}
      className="fixed inset-0 z-[85] flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label={t('aria.dismiss')}
        onClick={dismiss}
        className="
          absolute inset-0
          bg-[color:color-mix(in_oklab,var(--bg)_75%,black_20%)]/80
          backdrop-blur-[6px]
        "
      />
      <div
        ref={dialogRef}
        className="
          relative z-10 w-full max-w-[480px]
          border border-[var(--border)] bg-[var(--surface)]
          rounded-2xl shadow-[0_24px_72px_-32px_rgba(0,0,0,0.6)]
          motion-safe:promo-modal-fade-in
          overflow-hidden
        "
      >
        <button
          type="button"
          aria-label={t('aria.dismiss')}
          onClick={dismiss}
          className="
            absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center
            rounded-md text-[var(--fg-3)]
            hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
            transition-colors
            focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-[var(--accent)]
          "
        >
          <X size={14} strokeWidth={2} />
        </button>

        <div className="px-8 pt-8 pb-7">
          <StepDots phase={phase} />
          {body[phase] ?? null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function StepDots({ phase }: { phase: OnboardingPhase }) {
  const idx = useMemo(
    () => ({ connect: 0, siws: 1, 'trial-intro': 2, done: 3, closed: -1 })[phase],
    [phase],
  );
  return (
    <div className="flex items-center gap-1.5 mb-5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={`
            h-1 rounded-full transition-all duration-300
            ${
              i === idx
                ? 'w-6 bg-[var(--fg)]'
                : i < idx
                  ? 'w-3 bg-[var(--fg-2)]'
                  : 'w-3 bg-[var(--border)]'
            }
          `}
        />
      ))}
    </div>
  );
}

function StepShell({
  icon,
  eyebrow,
  title,
  body,
  primary,
  skip,
  onSkip,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  primary: ReactNode;
  skip: string | undefined;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="text-[var(--fg)]">{icon}</div>
      <div className="flex flex-col gap-2">
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {eyebrow}
        </p>
        <h2 className="display text-[22px] leading-tight tracking-tight font-semibold text-[var(--fg)]">
          {title}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)] mt-1">
          {body}
        </p>
      </div>
      <div className="flex flex-col gap-3 mt-2">
        {primary}
        {skip && (
          <button
            type="button"
            onClick={onSkip}
            className="
              text-[12px] text-[var(--fg-3)] hover:text-[var(--fg-2)]
              transition-colors self-center
            "
          >
            {skip}
          </button>
        )}
      </div>
    </div>
  );
}
