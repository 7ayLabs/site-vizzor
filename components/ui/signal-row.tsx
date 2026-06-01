/**
 * SignalRow — single-line render of a SignalContribution. Family icon in an
 * accent-tinted square, family name, a horizontal CF bar whose width encodes
 * |cf| and whose color encodes direction (positive=accent, negative=danger,
 * near-zero=fg-3), and an optional right-aligned meta key/value pair.
 * Compact mode drops the icon and shrinks to 24px row height — used when
 * stacking many signals inside an expanded PredictionCard.
 */

import {
  Activity,
  Brain,
  Scale,
  Newspaper,
  LineChart,
  GitBranch,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SignalContribution, SignalFamily } from '@/lib/types';

export interface SignalRowProps {
  signal: SignalContribution;
  compact?: boolean;
}

const FAMILY_ICON: Record<SignalFamily, LucideIcon> = {
  onChain: Activity,
  mlEnsemble: Brain,
  predictionMarkets: Scale,
  socialNarrative: Newspaper,
  patternMatch: LineChart,
  logicRules: GitBranch,
};

const FAMILY_LABEL: Record<SignalFamily, string> = {
  onChain: 'On-chain',
  mlEnsemble: 'ML ensemble',
  predictionMarkets: 'Prediction markets',
  socialNarrative: 'Social narrative',
  patternMatch: 'Pattern match',
  logicRules: 'Logic rules',
};

const NEAR_ZERO = 0.04;

function cfColor(cf: number): string {
  if (Math.abs(cf) < NEAR_ZERO) return 'var(--fg-3)';
  return cf > 0 ? 'var(--accent)' : 'var(--danger)';
}

function pickMeta(meta: SignalContribution['meta']): { key: string; value: string } | null {
  if (!meta) return null;
  const entries = Object.entries(meta);
  if (entries.length === 0) return null;
  const first = entries[0];
  if (!first) return null;
  const [key, raw] = first;
  const value = typeof raw === 'number' ? raw.toFixed(2) : raw;
  return { key, value };
}

export function SignalRow({ signal, compact = false }: SignalRowProps) {
  const Icon = FAMILY_ICON[signal.family];
  const label = FAMILY_LABEL[signal.family];
  const barColor = cfColor(signal.cf);
  const barWidth = Math.min(100, Math.abs(signal.cf) * 100);
  const meta = pickMeta(signal.meta);

  return (
    <div
      className={cn(
        'flex items-center gap-3 w-full',
        compact ? 'h-6' : 'h-8',
      )}
    >
      {!compact && (
        <span
          aria-hidden
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-md',
            'h-8 w-8',
          )}
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
          }}
        >
          <Icon size={16} strokeWidth={1.5} />
        </span>
      )}

      <span
        className={cn(
          'shrink-0 text-[12px] text-[var(--fg-2)] truncate',
          compact ? 'w-[110px]' : 'w-[130px]',
        )}
        title={label}
      >
        {label}
      </span>

      <div
        className="relative flex-1 overflow-hidden rounded-full"
        role="meter"
        aria-label={`${label} contribution`}
        aria-valuenow={Math.round(signal.cf * 100)}
        aria-valuemin={-100}
        aria-valuemax={100}
        style={{
          height: compact ? 3 : 4,
          backgroundColor: 'var(--surface-2)',
        }}
      >
        <div
          className="h-full transition-[width] duration-200 ease-out"
          style={{ width: `${barWidth}%`, backgroundColor: barColor }}
        />
      </div>

      {meta && (
        <span className="mono tabular shrink-0 text-[11px] leading-none whitespace-nowrap">
          <span className="text-[var(--fg-3)]">{meta.key}</span>
          <span className="ml-1 text-[var(--fg)]">{meta.value}</span>
        </span>
      )}
    </div>
  );
}
