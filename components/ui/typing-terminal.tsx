'use client';

/**
 * TypingTerminal — terminal block that types its content out character-
 * by-character when it enters the viewport. Identical chrome to the
 * static `TerminalBlock` (dark code surface, gutter, prompt, copy
 * button) so it can drop in wherever TerminalBlock is used.
 *
 * Trigger: IntersectionObserver, one-shot. Once the block has been on
 * screen, it types out the full body in `durationMs` (default 1.4 s)
 * and pins the cursor blinking at the end. Hovering the typed block
 * re-runs the typing animation — Bloomberg-terminal feel without
 * looping it forever.
 *
 * Reduced-motion: snaps to the final state instantly; no typing, no
 * blink. The copy button still works.
 *
 * Implementation note: the cursor is a single block character (▍)
 * appended to whatever's currently typed. We don't try to maintain
 * per-line cursor position — the cursor lives at the *end* of the
 * visible text, regardless of where line breaks fall. That matches
 * the "watching someone type" mental model without per-line edge cases.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReducedMotionSafe } from '@/lib/motion';

export interface TypingTerminalProps {
  code: string;
  lang?: string;
  showPrompt?: boolean;
  /** Total typing duration in ms — clamped to a sensible per-char min. */
  durationMs?: number;
  /** Trigger threshold for IntersectionObserver. Default 0.2 = visible
   *  20%, which is the "I can see it" line on a typical viewport. */
  threshold?: number;
}

export function TypingTerminal({
  code,
  lang,
  showPrompt = false,
  durationMs = 1400,
  threshold = 0.2,
}: TypingTerminalProps) {
  const reduced = useReducedMotionSafe();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const [typedLen, setTypedLen] = useState<number>(reduced ? code.length : 0);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<boolean>(reduced);

  // Per-character interval — clamp so very short bodies still feel
  // intentional and very long bodies don't drag forever.
  const perChar = useMemo(() => {
    const raw = durationMs / Math.max(1, code.length);
    return Math.max(8, Math.min(40, raw));
  }, [durationMs, code.length]);

  const startTyping = useCallback(() => {
    if (reduced || startedRef.current) return;
    startedRef.current = true;
    setDone(false);
    setTypedLen(0);
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      acc += delta;
      const advance = Math.floor(acc / perChar);
      if (advance > 0) {
        acc -= advance * perChar;
        setTypedLen((prev) => {
          const next = Math.min(code.length, prev + advance);
          if (next >= code.length) {
            setDone(true);
            return code.length;
          }
          return next;
        });
      }
      // Stop when we've reached the end.
      if (startedRef.current === false) return;
      const inProgress = typedLenRef.current < code.length;
      if (inProgress) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [code.length, perChar, reduced]);

  // Mirror typedLen into a ref so the RAF loop can read it without
  // re-creating the closure each tick.
  const typedLenRef = useRef(typedLen);
  useEffect(() => {
    typedLenRef.current = typedLen;
    if (typedLen >= code.length && rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [typedLen, code.length]);

  // IntersectionObserver — one-shot trigger.
  useEffect(() => {
    if (reduced) {
      setTypedLen(code.length);
      setDone(true);
      return;
    }
    const root = wrapperRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
            startTyping();
            io.unobserve(entry.target);
            break;
          }
        }
      },
      { threshold: [0, threshold, 1] },
    );
    io.observe(root);
    return () => {
      io.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startedRef.current = false;
    };
  }, [reduced, threshold, startTyping, code.length]);

  // Hover re-trigger — replay the typing once for the user who just
  // arrived; cancel any in-flight animation first.
  const handleReplay = useCallback(() => {
    if (reduced) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startedRef.current = false;
    startTyping();
  }, [reduced, startTyping]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — silent no-op.
    }
  }, [code]);

  const visible = code.slice(0, typedLen);
  const lines = useMemo(() => visible.split('\n'), [visible]);
  const totalLines = useMemo(() => code.split('\n').length, [code]);
  const gutterWidth = String(totalLines).length;

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={handleReplay}
      className={cn(
        'group relative w-full max-w-full overflow-hidden rounded-xl',
        'border border-[var(--border)]',
        'bg-[var(--code-bg)] text-[var(--code-fg)]',
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-2">
          {/* macOS-style window dots — purely decorative, signals
              "this is a terminal" at a glance. */}
          <span aria-hidden className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-white/15" />
            <span className="h-2 w-2 rounded-full bg-white/15" />
            <span className="h-2 w-2 rounded-full bg-white/15" />
          </span>
          <span className="mono text-[10px] uppercase tracking-[0.18em] text-white/40 ml-1">
            {lang ?? 'shell'}
          </span>
        </div>
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
            const isLastLine = idx === lines.length - 1;
            return (
              <span key={`l-${lineNo}`} className="flex items-start">
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
                <span className="flex-1">
                  {line || ' '}
                  {/* Cursor lives at the very end of the visible text,
                      not at the end of every line. Blinks once typing
                      completes; solid while typing for "live caret"
                      readability. */}
                  {isLastLine && (
                    <span
                      aria-hidden
                      className={cn(
                        'inline-block w-[0.5em] h-[1em] -mb-[2px] ml-[1px] align-middle',
                        'bg-[var(--code-fg)]',
                        done && 'motion-safe:[animation:typing-terminal-blink_1s_step-end_infinite]',
                      )}
                    />
                  )}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
