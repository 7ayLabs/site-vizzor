'use client';

/**
 * CopyChip — pill-shaped chip surfacing a shell command. Mono font, accent `$`
 * prompt on the left, copy icon on the right that swaps to a check on click.
 * Entire chip is clickable. Used in install/quickstart blocks across the site.
 */

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CopyChipProps {
  command: string;
  label?: string;
}

export function CopyChip({ command, label }: CopyChipProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable; swallow silently.
    }
  }, [command]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label ?? `Copy command: ${command}`}
      className={cn(
        'inline-flex items-center gap-2.5 rounded-full',
        'border border-[var(--border)] bg-[var(--surface)]',
        'px-3.5 py-1.5 text-[12px]',
        'text-[var(--fg)] transition-colors duration-150',
        'hover:bg-[var(--surface-2)] active:scale-[0.98]',
      )}
    >
      <span
        aria-hidden
        className="mono font-semibold text-[var(--accent)] select-none"
      >
        $
      </span>
      <span className="mono tabular whitespace-nowrap">{command}</span>
      <span
        aria-hidden
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center',
          'transition-colors duration-150',
          copied ? 'text-[var(--accent)]' : 'text-[var(--fg-3)]',
        )}
      >
        {copied ? (
          <Check size={14} strokeWidth={1.5} />
        ) : (
          <Copy size={14} strokeWidth={1.5} />
        )}
      </span>
    </button>
  );
}
