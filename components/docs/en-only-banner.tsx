/**
 * EnOnlyBanner — small "English-only for now" notice rendered above every
 * doc page body. The v0.1.0 docs ship EN only; deep technical content
 * (CLI reference, ChronoVisor math, Telegram surface) lands in Spanish + French
 * in v0.2. This banner sets reader expectations without cluttering the prose.
 */

import { Globe } from 'lucide-react';

export function EnOnlyBanner() {
  return (
    <aside
      role="note"
      aria-label="English-only docs notice"
      className="not-prose mb-6 flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-[13px] leading-snug text-[var(--fg-2)]"
    >
      <Globe
        size={16}
        strokeWidth={1.75}
        className="mt-[2px] shrink-0 text-[var(--accent)]"
        aria-hidden
      />
      <div>
        <span className="font-semibold text-[var(--fg)]">
          Docs are English-only for v0.1.0.
        </span>{' '}
        Spanish and French translations of the full reference land in v0.2.
        The marketing site already supports EN · ES · FR — only this docs
        zone is EN-first.
      </div>
    </aside>
  );
}
