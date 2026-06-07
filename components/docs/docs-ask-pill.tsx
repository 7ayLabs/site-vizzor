'use client';

/**
 * Floating "Ask Vizzor" pill + Ask-Vizzor docs chatbot modal.
 *
 * The pill is rendered fixed bottom-right on every docs page. Clicking
 * it opens a modal that answers questions **scoped strictly to Vizzor's
 * documentation, functionalities, and tutorials** — it is *not* a live
 * prediction surface (that lives at `/predict`) and it does *not* take
 * users off-site (Telegram lives under "Open in Telegram" affordances
 * in the marketing pages).
 *
 * UI is modelled on Polkadot's docs chatbot pattern: dark header strip
 * with the brand mark + title + close, disclaimer banner, textarea
 * with capability toggles, send affordance, and a small "Docs-only"
 * footer note. Everything resolves through the project's B&W token
 * discipline (`var(--fg)` / `var(--bg)` / `var(--border)` / etc.) —
 * no Polkadot-ish purple, no separate font stack.
 *
 * Modal lifecycle mirrors the lifetime-promo-modal — a phase machine
 * (closed → opening → open → closing) drives the fade / slide. ESC
 * + backdrop dismiss + focus return + body scroll-lock all wired.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ArrowUp, X, BookText, Send } from 'lucide-react';

type Phase = 'closed' | 'opening' | 'open' | 'closing';
const EXIT_MS = 200;

export function DocsAskPill() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="
          fixed bottom-5 right-5 z-40
          inline-flex h-12 items-center gap-2 rounded-full
          border border-[var(--border)] bg-[var(--surface)] pl-1.5 pr-4
          text-[13px] font-semibold tracking-tight text-[var(--fg)]
          shadow-[0_12px_32px_-12px_color-mix(in_oklab,var(--fg)_35%,transparent)]
          transition-[transform,background,opacity] duration-150
          hover:bg-[var(--surface-2)] motion-safe:hover:-translate-y-0.5
        "
        aria-label="Ask Vizzor — open the docs chatbot"
      >
        <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]">
          <Image
            src="/brand/vizzor_darkicon.png"
            alt=""
            width={364}
            height={535}
            className="block dark:hidden h-5 w-auto"
          />
          <Image
            src="/brand/vizzor_icon.png"
            alt=""
            width={364}
            height={535}
            className="hidden dark:block h-5 w-auto"
          />
        </span>
        <span>Ask Vizzor</span>
      </button>

      <AskVizzorModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Modal                                                                  */
/* ────────────────────────────────────────────────────────────────────── */

interface AskVizzorModalProps {
  open: boolean;
  onClose: () => void;
}

function AskVizzorModal({ open, onClose }: AskVizzorModalProps) {
  const [phase, setPhase] = useState<Phase>('closed');
  const [mounted, setMounted] = useState(false);
  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Phase machine driven by the controlled `open` prop.
  useEffect(() => {
    if (open) {
      setPhase((p) => (p === 'closed' || p === 'closing' ? 'opening' : p));
      const id = window.requestAnimationFrame(() =>
        setPhase((p) => (p === 'opening' ? 'open' : p)),
      );
      return () => window.cancelAnimationFrame(id);
    }
    setPhase((p) => (p === 'closed' ? p : 'closing'));
    const id = window.setTimeout(() => setPhase('closed'), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  // Reset transient state every time the modal is closed.
  useEffect(() => {
    if (phase === 'closed') {
      setQuestion('');
      setSubmitted(false);
    }
  }, [phase]);

  // Focus the textarea once the open phase commits.
  useEffect(() => {
    if (phase === 'open') {
      inputRef.current?.focus();
    }
  }, [phase]);

  // ESC dismiss while interactive.
  useEffect(() => {
    if (phase !== 'open' && phase !== 'opening') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  // Body-scroll lock while visible.
  useEffect(() => {
    if (phase === 'closed') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phase]);

  if (!mounted || phase === 'closed') return null;

  const exiting = phase === 'closing';

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (question.trim().length === 0) return;
    // Vizzor's docs AI is in beta — submission just transitions to the
    // ack state for now. Real wiring (kapa.ai / a self-hosted retriever
    // over the MDX corpus) is the follow-up.
    setSubmitted(true);
  }

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-vizzor-title"
      className={`
        fixed inset-0 z-[60] flex items-end justify-center sm:items-center
        ${exiting ? 'motion-safe:promo-modal-fade-out' : 'motion-safe:promo-modal-fade-in'}
      `}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close Ask Vizzor"
        onClick={onClose}
        className="absolute inset-0 bg-[color:color-mix(in_oklab,var(--bg)_60%,black_30%)]/80 backdrop-blur-sm"
      />

      <div
        className={`
          relative z-10 flex w-full max-w-[680px] flex-col
          overflow-hidden rounded-2xl
          border border-[var(--border)] bg-[var(--surface)]
          shadow-[0_28px_72px_-12px_rgba(0,0,0,0.5)]
          mx-3 mb-3 sm:mx-0 sm:mb-0
          ${exiting ? 'motion-safe:promo-modal-slide-out' : 'motion-safe:promo-modal-slide-in'}
        `}
      >
        {/* ── Header strip — inverted (fg surface, bg text) ─────────── */}
        <header
          className="
            flex items-center justify-between gap-3
            bg-[var(--fg)] text-[var(--bg)]
            px-5 py-4
          "
        >
          <div className="flex items-center gap-3 min-w-0">
            {/*
              In the inverted strip we want the *white* brand mark on
              both themes (since the surface is always the project's
              foreground color). The Image swap pattern reverses: the
              dark-icon (black mark) ships for dark theme so it reads
              white on white; the icon (white mark) ships for light
              theme so it reads white on black. We just take the white
              mark — that's `vizzor_icon.png`.
            */}
            <span className="relative inline-flex h-8 w-8 items-center justify-center">
              <Image
                src="/brand/vizzor_icon.png"
                alt=""
                width={364}
                height={535}
                className="h-5 w-auto"
              />
            </span>
            <h2
              id="ask-vizzor-title"
              className="text-[15px] font-semibold tracking-tight truncate"
            >
              Ask Vizzor · Docs assistant
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="
              -mr-1 inline-flex h-8 w-8 items-center justify-center
              rounded-full text-[color:color-mix(in_oklab,var(--bg)_85%,transparent)]
              hover:bg-[color:color-mix(in_oklab,var(--bg)_15%,transparent)]
              transition-colors
            "
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        </header>

        {/* ── Body ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5 px-5 py-5">
          {/* Disclaimer panel */}
          <div
            className="
              rounded-xl border border-[var(--border)] bg-[var(--surface-2)]
              px-4 py-3.5 text-[12.5px] leading-[1.55] text-[var(--fg-2)]
            "
          >
            <p>
              This assistant is scoped to the <span className="font-semibold text-[var(--fg)]">Vizzor documentation</span> — features, commands, surfaces, and tutorials. It is <span className="font-semibold text-[var(--fg)]">not</span> a live prediction surface; for forecasts use{' '}
              <a
                href="/predict"
                className="underline underline-offset-4 hover:text-[var(--fg)]"
              >
                /predict
              </a>{' '}
              or the Telegram bot. Answers may be incomplete — please don't share private keys, mnemonics, or auth tokens. By submitting you agree to the{' '}
              <a
                href="/legal/privacy"
                className="underline underline-offset-4 hover:text-[var(--fg)]"
              >
                privacy policy
              </a>
              .
            </p>
          </div>

          {/* Form */}
          {submitted ? (
            <SubmittedAck onAskAnother={() => setSubmitted(false)} />
          ) : (
            <form
              onSubmit={handleSubmit}
              className="
                rounded-xl border border-[var(--border)] bg-[var(--bg)]
                focus-within:border-[var(--fg-3)]
                transition-colors
              "
            >
              <textarea
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask anything about Vizzor's docs — e.g. “how does the high-conviction tier qualify?”"
                rows={3}
                className="
                  w-full resize-none bg-transparent
                  px-4 pt-3.5 pb-2
                  text-[14px] leading-[1.5] text-[var(--fg)]
                  placeholder:text-[var(--fg-3)]
                  outline-none
                "
                onKeyDown={(e) => {
                  // Submit on Cmd/Ctrl+Enter; let plain Enter add a line.
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />

              <div className="flex items-center justify-between gap-3 px-3 pb-3">
                <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
                  ⌘ + Enter to send
                </p>
                <button
                  type="submit"
                  disabled={question.trim().length === 0}
                  className="
                    inline-flex h-8 w-8 items-center justify-center
                    rounded-full bg-[var(--fg)] text-[var(--bg)]
                    transition-[opacity,transform] duration-150
                    disabled:opacity-30 disabled:cursor-not-allowed
                    enabled:hover:opacity-90 enabled:motion-safe:hover:scale-[1.04]
                  "
                  aria-label="Send question"
                >
                  <ArrowUp size={15} strokeWidth={2.4} />
                </button>
              </div>
            </form>
          )}

          {/* Quick prompts */}
          {!submitted && question.trim().length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
                Try a starter
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setQuestion(p)}
                    className="
                      inline-flex h-8 items-center gap-2 rounded-full
                      border border-[var(--border)] bg-[var(--surface)]
                      px-3 text-[12px] text-[var(--fg-2)]
                      hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
                      transition-colors
                    "
                  >
                    <BookText
                      size={11}
                      strokeWidth={2}
                      aria-hidden
                      className="text-[var(--fg-3)]"
                    />
                    <span className="truncate">{p}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────── */}
        <footer
          className="
            flex items-center justify-between gap-3
            border-t border-[var(--border)] bg-[var(--surface-2)]/60
            px-5 py-3
          "
        >
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
            Docs-only · no live predictions
          </p>
          <p className="text-[11.5px] text-[var(--fg-3)]">
            Powered by Vizzor
          </p>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

const STARTER_PROMPTS = [
  'How does the high-conviction tier qualify?',
  'What does the Whale Terminal show?',
  'Explain Platt calibration',
  'How do I run the CLI?',
  'What chains are supported?',
];

/* ────────────────────────────────────────────────────────────────────── */
/*  Submitted ack — beta state                                             */
/* ────────────────────────────────────────────────────────────────────── */

function SubmittedAck({ onAskAnother }: { onAskAnother: () => void }) {
  return (
    <div
      className="
        rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/60
        px-4 py-4 flex flex-col gap-3
      "
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="
            inline-flex h-7 w-7 items-center justify-center rounded-full
            bg-[var(--fg)] text-[var(--bg)]
          "
        >
          <Send size={13} strokeWidth={2.4} />
        </span>
        <p className="text-[13.5px] font-semibold tracking-tight text-[var(--fg)]">
          Got it — docs assistant is in beta
        </p>
      </div>
      <p className="text-[12.5px] leading-[1.55] text-[var(--fg-2)]">
        We logged your question. The retrieval index over the MDX corpus ships in the next docs slice; until then, search the page tree or browse the section that's closest to your topic.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onAskAnother}
          className="
            inline-flex h-9 items-center rounded-full
            border border-[var(--fg)] bg-[var(--surface)] px-4
            text-[12.5px] font-semibold tracking-tight text-[var(--fg)]
            hover:bg-[var(--surface-2)]
            transition-colors
          "
        >
          Ask another
        </button>
        <a
          href="/docs"
          className="
            inline-flex h-9 items-center rounded-full
            bg-[var(--fg)] px-4
            text-[12.5px] font-semibold tracking-tight text-[var(--bg)]
            hover:opacity-90 transition-opacity
          "
        >
          Browse the docs
        </a>
      </div>
    </div>
  );
}
