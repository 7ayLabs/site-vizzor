'use client';

/**
 * TradeTag — the shared visual affordance for a capability intent,
 * everywhere it appears: intent chat card header, workflows page
 * row, alerts drawer entry.
 *
 * Content vocabulary is deliberately compact — one line, monospace
 * tabular so the columns align vertically when multiple tags stack.
 * Left: short intent id (#itn_abcd…). Middle: kind glyph + amount
 * + symbol. Right: status pill and optional signed-realized ±% delta.
 *
 * The `winLossPct` slot is present but null-by-default. The engine
 * doesn't yet emit realized PnL for an executed intent (that's part
 * of the engine's v0.5.2 auto-trade work); when it does, the tag
 * fills the slot without any consumer needing changes.
 */

import { useTranslations } from 'next-intl';
import { CalendarClock, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CapId } from '@/lib/capabilities/intent';

type IntentStatus =
  | 'pending'
  | 'signed'
  | 'executed'
  | 'failed'
  | 'expired';

const KIND_GLYPH: Record<CapId, typeof DollarSign> = {
  transfer: DollarSign,
  payment: CalendarClock,
};

const KIND_ACCENT: Record<CapId, string> = {
  transfer: '--cap-transfer',
  payment: '--cap-payment',
};

export interface TradeTagProps {
  intentId: string;
  kind: CapId;
  symbol: string;
  amount: string;
  status: IntentStatus;
  /**
   * Realized/projected win-loss as a fraction (0.05 = +5%). Null when
   * the engine hasn't reported one yet (all pending intents; executed
   * ones from before the engine v0.5.2 auto-trade work).
   */
  winLossPct?: number | null;
  /**
   * Compact mode drops the intent-id chip and shrinks the status pill.
   * Used inside dense list rows (alerts drawer). The full tag is used
   * in the workflows page and the intent chat card header.
   */
  compact?: boolean;
  className?: string;
}

export function TradeTag({
  intentId,
  kind,
  symbol,
  amount,
  status,
  winLossPct = null,
  compact = false,
  className,
}: TradeTagProps) {
  const t = useTranslations('predict.workflows.status');
  const Glyph = KIND_GLYPH[kind];
  const accentVar = KIND_ACCENT[kind];
  const idShort = shortenIntentId(intentId);
  const statusTone = STATUS_TONE[status];
  const hasWinLoss =
    typeof winLossPct === 'number' && Number.isFinite(winLossPct);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 align-middle',
        'mono tabular text-[10px] leading-none',
        className,
      )}
      aria-label={`intent ${idShort} ${kind} ${amount} ${symbol} ${status}`}
    >
      {!compact && (
        <span
          className={cn(
            'inline-flex items-center h-[16px] px-1.5 rounded',
            'border border-[var(--border)] text-[var(--fg-3)]',
          )}
        >
          #{idShort}
        </span>
      )}
      <span
        className="inline-flex items-center gap-1"
        style={{ color: `var(${accentVar})` }}
      >
        <Glyph size={10} strokeWidth={2.4} aria-hidden />
        <span className="font-semibold">
          {amount} {symbol}
        </span>
      </span>
      <span
        className={cn(
          'inline-flex items-center h-[16px] px-1.5 rounded uppercase tracking-[0.16em] font-semibold',
          'border border-[var(--border)]',
          statusTone,
        )}
      >
        {t(status)}
      </span>
      {hasWinLoss && (
        <WinLossDelta pct={winLossPct as number} />
      )}
    </span>
  );
}

function WinLossDelta({ pct }: { pct: number }) {
  const isUp = pct >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 h-[16px] px-1.5 rounded',
        'border border-[var(--border)] font-semibold',
      )}
      style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}
    >
      <span aria-hidden>{isUp ? '▲' : '▼'}</span>
      {Math.abs(pct * 100).toFixed(2)}%
    </span>
  );
}

const STATUS_TONE: Record<IntentStatus, string> = {
  pending: 'text-[var(--accent)]',
  signed: 'text-[var(--fg-2)]',
  executed: 'text-[var(--up)]',
  failed: 'text-[var(--down)]',
  expired: 'text-[var(--fg-3)]',
};

/**
 * Short display id — first 4 + last 4 base58 chars. Matches the way
 * wallet addresses are shortened elsewhere in the app so the visual
 * shorthand is consistent.
 */
function shortenIntentId(id: string): string {
  const stripped = id.replace(/^itn_/, '');
  if (stripped.length <= 8) return stripped;
  return `${stripped.slice(0, 4)}…${stripped.slice(-4)}`;
}
