'use client';

/**
 * TerminalBlock — always-dark code surface with line numbers, optional
 * `vizzor>` prompt, line-range highlighting, and a copy-to-clipboard button.
 * Renders identically in light + dark mode (uses --code-bg / --code-fg which
 * are fixed across themes).
 */

import { useCallback, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TerminalBlockProps {
  code: string;
  lang?: string;
  highlightLines?: number[];
  showPrompt?: boolean;
}

export function TerminalBlock({
  code,
  lang,
  highlightLines,
  showPrompt = false,
}: TerminalBlockProps) {
  const [copied, setCopied] = useState(false);

  // Defensive coercion — MDX call sites occasionally pass an undefined
  // `code` prop (e.g., when a template literal evaluates to undefined
  // inside an MDX expression), and the split below would crash the
  // whole route. Empty string renders a single blank line + no copy
  // action, which is graceful and matches the visual rest state.
  const safeCode = typeof code === 'string' ? code : '';

  const handleCopy = useCallback(async () => {
    if (!safeCode) return;
    try {
      await navigator.clipboard.writeText(safeCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable; swallow silently — UI stays in default state.
    }
  }, [safeCode]);

  const lines = useMemo(() => safeCode.split('\n'), [safeCode]);
  const highlight = useMemo(
    () => new Set(highlightLines ?? []),
    [highlightLines],
  );

  const gutterWidth = String(lines.length).length;

  return (
    <div
      className={cn(
        'relative w-full max-w-full overflow-hidden rounded-xl',
        'border border-[var(--border)]',
        'bg-[var(--code-bg)] text-[var(--code-fg)]',
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="mono text-[10px] uppercase tracking-[0.18em] text-white/40">
          {lang ?? 'shell'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-white/10',
            'px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]',
            'text-white/60 transition-colors duration-150',
            'hover:text-white hover:bg-white/5 active:scale-[0.97]',
          )}
        >
          {copied ? (
            <>
              <Check size={12} strokeWidth={1.5} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} strokeWidth={1.5} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <pre
        className={cn(
          'mono tabular whitespace-pre overflow-x-auto',
          'p-4 text-[13px] leading-[1.55]',
        )}
      >
        <code>
          {lines.map((line, idx) => {
            const lineNo = idx + 1;
            const isHighlighted = highlight.has(lineNo);
            return (
              <span
                key={`l-${lineNo}`}
                className={cn(
                  'flex items-start',
                  isHighlighted && 'bg-[var(--accent)]/10',
                )}
              >
                <span
                  aria-hidden
                  className="select-none pr-4 text-right text-white/25 mono tabular"
                  style={{ minWidth: `${gutterWidth + 1}ch` }}
                >
                  {lineNo}
                </span>
                {showPrompt && (
                  <span
                    aria-hidden
                    className="select-none pr-2 text-[var(--accent)] mono"
                  >
                    vizzor&gt;
                  </span>
                )}
                <span className="flex-1">{line || ' '}</span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
