'use client';

/**
 * InstallSheet — side-panel for installing a connector.
 *
 * Skills never open this sheet — they're a single PATCH on the catalog
 * shell. Connectors arrive here with a `config_schema` declaring the
 * fields to collect.
 *
 * Mounted via `fixed inset-0 z-[60]` to escape any sticky parent stacking
 * context (same defense pattern as the predict-shell modals — see
 * commit 5c0170b).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

type Category = 'connector' | 'skill';

export interface InstallTarget {
  connectorId: string;
  name: string;
  category: Category;
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
      <aside className="relative w-full max-w-[400px] h-dvh bg-[var(--surface)] border-l border-[var(--border)] p-6 overflow-y-auto flex flex-col gap-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
              {t(`category.${target.category}.label`)}
            </p>
            <h2 className="mt-1 text-[15px] font-semibold text-[var(--fg)] leading-tight">
              {target.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors shrink-0"
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
                autoComplete="off"
                spellCheck={false}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--fg)] outline-none focus:border-[var(--fg-3)] font-mono"
              />
            </label>
          ))}

          {error && (
            <p className="text-[12px] text-red-400 leading-snug">
              {t(`install.error.${error}`, {
                fallback: t('install.error.generic'),
              } as never)}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-[12.5px] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] active:scale-[0.97] transition-all duration-150"
            >
              {t('install.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--accent)] px-3 py-2 text-[12.5px] font-medium text-black hover:opacity-90 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 transition-all duration-150"
            >
              {submitting ? t('install.submitting') : t('install.submit')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
