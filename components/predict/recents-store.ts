/**
 * recents-store — localStorage-backed list of recent user prompts.
 *
 * The on-site chat is stateless server-side (no accounts), so the
 * "Recents" sidebar list lives in the browser. Bounded to 25 entries,
 * deduped on insert, ordered newest-first.
 *
 * The Vizzor product persists conversations on the server via
 * `POST /v1/conversations`, but consuming that requires per-user auth
 * the site doesn't ship yet. localStorage is the right primitive
 * until then — privacy-respecting, no roundtrip, instant.
 */

const KEY = 'vizzor.predict.recents';
const LIMIT = 25;

export interface RecentEntry {
  id: string;
  prompt: string;
  ts: number;
}

function read(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: RecentEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, LIMIT)));
  } catch {
    // QuotaExceededError or disabled localStorage — silently skip.
  }
}

export function loadRecents(): RecentEntry[] {
  return read();
}

export function pushRecent(prompt: string): RecentEntry[] {
  const trimmed = prompt.trim();
  if (!trimmed) return read();
  const existing = read().filter(
    (r) => r.prompt.toLowerCase() !== trimmed.toLowerCase(),
  );
  const next: RecentEntry[] = [
    {
      id: 'r_' + Date.now().toString(36),
      prompt: trimmed.slice(0, 200),
      ts: Date.now(),
    },
    ...existing,
  ].slice(0, LIMIT);
  write(next);
  return next;
}

export function clearRecents(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignored
  }
}
