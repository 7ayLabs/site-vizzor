'use client';

/**
 * SupportCodeChip — renders a `VZ-XXX-NNN` error code as a mono
 * tabular chip with a copy-to-clipboard affordance. Used inside
 * error states so users can paste the exact code into a support
 * ticket / Telegram bot conversation and we can trace it to one
 * code path.
 *
 * Visual: hairline border, monospace tabular figure body. No
 * background fill so it blends with whatever danger / surface
 * the parent renders.
 */

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export interface SupportCodeChipProps {
  code: string;
  /** Optional internal slug appended after a `·` separator. */
  slug?: string;
  /** Localised label for the copy button (aria + tooltip). */
  copyLabel: string;
  /** Localised label that's read after a successful copy. */
  copiedLabel: string;
}

export function SupportCodeChip({
  code,
  slug,
  copyLabel,
  copiedLabel,
}: SupportCodeChipProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignored — clipboard can be blocked by perms in iframes etc.
    }
  }, [code]);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 mono tabular text-[10px] tracking-[0.06em] text-[var(--fg-2)]">
      <span>{code}</span>
      {slug && (
        <>
          <span aria-hidden className="text-[var(--fg-3)]">·</span>
          <span className="text-[var(--fg-3)]">{slug}</span>
        </>
      )}
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={copied ? copiedLabel : copyLabel}
        className="-mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface)] transition-colors"
      >
        {copied ? (
          <Check size={11} strokeWidth={2.4} />
        ) : (
          <Copy size={11} strokeWidth={2} />
        )}
      </button>
    </span>
  );
}
