'use client';

/**
 * InstallSheet — modal side-panel for collecting credentials when the
 * user clicks `+` on a webhook or apikey entry. Renders the entry's
 * config_schema fields with kind-aware inputs (url, secret, text).
 *
 * Submits to POST /api/directory/install. Server-side validation runs
 * the regex + SSRF guard; client-side validation is only for fast UX
 * feedback (the wire is the source of truth).
 *
 * Hoisted out of the page's main layout via fixed positioning so it
 * never gets trapped by a sticky stacking context (the same fix that
 * unblocked ProductSidebar modals — see commit 5c0170b).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

export interface InstallTarget {
  connectorId: string;
  name: string;
  schema: {
    fields: Array<{
      name: string;
      label: string;
      placeholder?: string;
      kind: 'url' | 'secret' | 'text';
      pattern?: string;
      required: boolean;
    }>;
  } | null;
}

interface Props {
  target: InstallTarget | null;
  onClose: () => void;
  onInstalled: () => void;
}

export function InstallSheet({ target, onClose, onInstalled }: Props) {
  const t = useTranslations('app.directory');
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;
  const fields = target.schema?.fields ?? [];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/directory/install', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          connector_id: target.connectorId,
          credentials: values,
        }),
      });
      const body = (await res.json()) as { ok: boolean; reason?: string };
      if (!res.ok || !body.ok) {
        setError(body.reason ?? 'install_failed');
        return;
      }
      onInstalled();
      setValues({});
    } catch {
      setError('install_failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="relative w-full max-w-[420px] h-dvh bg-[var(--surface)] border-l border-[var(--border)] p-6 overflow-y-auto">
        <header className="flex items-center justify-between mb-6">
          <h2 className="text-[16px] font-semibold text-[var(--fg)]">
            {t('install.title', { name: target.name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]"
            aria-label={t('install.close')}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {fields.map((f) => (
            <label key={f.name} className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-[var(--fg-2)]">
                {f.label}
                {f.required && <span className="text-[var(--accent)] ml-1">*</span>}
              </span>
              <input
                type={f.kind === 'secret' ? 'password' : f.kind === 'url' ? 'url' : 'text'}
                value={values[f.name] ?? ''}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.name]: e.target.value }))
                }
                placeholder={f.placeholder}
                required={f.required}
                pattern={f.pattern}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--fg)] outline-none focus:border-[var(--fg-3)]"
              />
            </label>
          ))}

          {error && (
            <p className="text-[12px] text-red-400">
              {t(`install.error.${error}`, {
                fallback: t('install.error.generic'),
              } as never)}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-[13px] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
            >
              {t('install.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--accent)] px-3 py-2 text-[13px] font-medium text-black hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? t('install.submitting') : t('install.submit')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
