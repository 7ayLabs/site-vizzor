/**
 * LiveBadge — mono "LIVE" pill with a tone-tinted pulsing dot.
 *
 * Tones map to the terminal palette:
 *   - mint  → primary signal (default)
 *   - gold  → premium / tier surface
 *   - whale → institutional flow surface
 *
 * The dot animation reuses the global `pulse-dot` keyframe; the
 * `prefers-reduced-motion: reduce` rule in globals.css clamps the
 * duration to ~0ms so reduced-motion users see a static dot.
 *
 * Server-renderable — no client hooks, just static markup.
 */
import { cn } from '@/lib/utils';

export type LiveBadgeTone = 'mint' | 'gold' | 'whale';

export interface LiveBadgeProps {
  label?: string;
  tone?: LiveBadgeTone;
  className?: string;
}

const TONE_DOT: Record<LiveBadgeTone, string> = {
  mint: 'var(--accent)',
  gold: 'var(--gold)',
  whale: 'var(--whale)',
};

const TONE_TEXT: Record<LiveBadgeTone, string> = {
  mint: 'text-[var(--accent)]',
  gold: 'text-[var(--gold)]',
  whale: 'text-[var(--whale)]',
};

export function LiveBadge({
  label = 'LIVE',
  tone = 'mint',
  className,
}: LiveBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 mono tabular',
        'text-[10px] font-semibold uppercase tracking-[0.18em] leading-none',
        TONE_TEXT[tone],
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          background: TONE_DOT[tone],
          animation: 'pulse-dot 1.6s ease-in-out infinite',
        }}
      />
      <span>{label}</span>
    </span>
  );
}
