'use client';

/**
 * InstallCommand — Ollama-style hero install affordance.
 *
 * One wide, flat rounded card the user can click anywhere on to copy
 * the command. The card itself is the trigger — there's no separate
 * copy button to hunt for. Tap feedback: the copy icon swaps to a
 * check for 1.5s.
 *
 * Visual treatment matches the rest of the B&W design system —
 * `--surface-2` panel, hairline border, `--fg` mono text. No accent
 * green, no pill rounding (rounded-2xl reads more "code surface").
 */

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InstallCommandProps {
  command: string;
  /** Optional aria-label override. Defaults to "Copy command: <command>". */
  ariaLabel?: string;
}

export function InstallCommand({ command, ariaLabel }: InstallCommandProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be denied — silent.
    }
  }, [command]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel ?? `Copy command: ${command}`}
      className={cn(
        'group inline-flex w-full items-center justify-between gap-2',
        'rounded-xl border border-[var(--border)] bg-[var(--surface-2)]',
        'px-3.5 py-2 text-left',
        'transition-colors duration-150',
        'hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
      )}
    >
      <span className="mono tabular text-[13px] text-[var(--fg)] truncate">
        <span className="text-[var(--fg-3)] select-none">$ </span>
        {command}
      </span>
      <span
        aria-hidden
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          'transition-colors duration-150',
          copied
            ? 'text-[var(--fg)]'
            : 'text-[var(--fg-3)] group-hover:text-[var(--fg)]',
        )}
      >
        {copied ? (
          <Check size={12} strokeWidth={2.4} />
        ) : (
          <Copy size={12} strokeWidth={2} />
        )}
      </span>
    </button>
  );
}
