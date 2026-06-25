/**
 * Wallet-scoped alerts proxy to the Vizzor engine.
 *
 * The engine is the source of truth — alerts live in the upstream
 * Vizzor service, fired by the alert-rule-engine + DM'd by the bot.
 * Every web-armed alert (manual modal form OR auto-armed from a chat
 * trade plan via the AI's `set_trade_plan_alerts` tool) lands in the
 * SAME engine table the Telegram/CLI surfaces read.
 *
 * Schema translation:
 *   - Engine stores `AlertRule` rows: { type, symbols[], priceAbove |
 *     priceBelow, label, userId, enabled, createdAt }
 *   - Site UI consumes `AlertRow` rows: { symbol, direction, price,
 *     kind, status, armedAt }
 *   - Mapping happens here so the rest of the site stays clean of
 *     engine internals.
 *
 * User-id contract:
 *   - The engine's `set_trade_plan_alerts` tool tags rules with
 *     `userId = web:<walletHash>` (matches the chat route's userId
 *     derivation in `app/api/predict/route.ts:257`).
 *   - This module derives the SAME userId from the wallet via the
 *     shared `walletToEngineUserId` helper so reads/writes pivot on
 *     the identical key.
 *
 * Security:
 *   - Wallet → userId derivation is server-side. The route reads
 *     `getActiveSession()` and passes the SIWS-bound wallet here.
 *   - Engine `GET /v1/alerts?userId=...` enforces ownership filtering
 *     (added on the engine side); we still type-guard the response.
 */

import { hashClientIp } from './payment/client-ip';
import type { AlertKind, AlertRow, AlertStatus, Direction } from './types';

const API_BASE =
  process.env.VIZZOR_API_URL ??
  process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
  'https://api.vizzor.ai';

const FETCH_TIMEOUT_MS = 5_000;

export interface AlertsBundle {
  armed: readonly AlertRow[];
  triggered: readonly AlertRow[];
  resolved: readonly AlertRow[];
  cancelled: readonly AlertRow[];
}

export interface AlertsReadResult {
  bundle: AlertsBundle;
  /** True when the engine returned cleanly; false when we served the
   *  empty fallback. UI uses this to render a "snapshot" pill. */
  live: boolean;
}

const EMPTY_BUNDLE: AlertsBundle = {
  armed: [],
  triggered: [],
  resolved: [],
  cancelled: [],
};

/**
 * Derive the engine user-id from a wallet. MUST match the derivation
 * in `app/api/predict/route.ts` so alerts armed by the AI in a chat
 * turn share the same scope as the modal's manual reads. The hash
 * truncation is the existing IP-hashing primitive (HMAC-SHA-256
 * truncated to 16 bytes) — opaque, deterministic per wallet, and
 * already vetted as a privacy-preserving identifier shape.
 */
export function walletToEngineUserId(wallet: string): string {
  if (!wallet) return '';
  return `web:${hashClientIp(wallet)}`;
}

function bucketByStatus(rows: readonly AlertRow[]): AlertsBundle {
  const out: { [K in AlertStatus]: AlertRow[] } = {
    armed: [],
    triggered: [],
    resolved: [],
    cancelled: [],
  };
  for (const row of rows) {
    if (row.status in out) {
      out[row.status].push(row);
    }
  }
  return {
    armed: out.armed,
    triggered: out.triggered,
    resolved: out.resolved,
    cancelled: out.cancelled,
  };
}

function authHeaders(): Record<string, string> {
  const apiKey = process.env.VIZZOR_API_KEY;
  const base: Record<string, string> = {
    accept: 'application/json',
  };
  if (apiKey) base['x-api-key'] = apiKey;
  return base;
}

/* ─────────────────────────── read path ─────────────────────────── */

/**
 * List alerts for the given wallet. Translates the engine's
 * `AlertRule[]` response into the site's `AlertRow[]` shape and
 * buckets by status so the UI can render directly.
 */
export async function listAlertsForWallet(
  wallet: string,
): Promise<AlertsReadResult> {
  if (!wallet) {
    return { bundle: EMPTY_BUNDLE, live: false };
  }

  const userId = walletToEngineUserId(wallet);
  const url = `${API_BASE}/v1/alerts?userId=${encodeURIComponent(userId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (!res.ok) {
      return { bundle: EMPTY_BUNDLE, live: false };
    }
    // Engine returns the raw `AlertRule[]` array, not a wrapped object.
    const json = (await res.json()) as unknown;
    const rules = Array.isArray(json) ? json : [];
    const rows: AlertRow[] = [];
    for (const raw of rules) {
      const row = ruleToRow(raw);
      if (row) rows.push(row);
    }
    return { bundle: bucketByStatus(rows), live: true };
  } catch {
    return { bundle: EMPTY_BUNDLE, live: false };
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── write path ─────────────────────────── */

export interface ArmAlertInput {
  symbol: string;
  kind: AlertKind;
  direction: Direction;
  price: number;
}

export type ArmAlertResult =
  | { ok: true; alert: AlertRow }
  | { ok: false; reason: 'invalid' | 'engine_unavailable' | 'rejected'; status?: number };

/**
 * Arm a new alert by writing through to the engine in its canonical
 * `AlertRule` schema. The wallet is converted to the same `userId`
 * the AI's `set_trade_plan_alerts` tool uses so manual arms and
 * AI-armed alerts coexist in the same per-wallet bucket.
 */
export async function armAlertForWallet(
  wallet: string,
  input: ArmAlertInput,
): Promise<ArmAlertResult> {
  if (!wallet) return { ok: false, reason: 'invalid' };
  if (!isValidArmInput(input)) return { ok: false, reason: 'invalid' };

  const userId = walletToEngineUserId(wallet);
  const symbol = input.symbol.toUpperCase();
  // Engine schema: priceAbove fires on cross-up, priceBelow on cross-down.
  const body = {
    type: 'price_threshold',
    symbols: [symbol],
    label: input.kind.toUpperCase(),
    ...(input.direction === 'up'
      ? { priceAbove: input.price }
      : { priceBelow: input.price }),
    userId,
  };

  const url = `${API_BASE}/v1/alerts`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, reason: 'rejected', status: res.status };
    }
    const created = (await res.json()) as unknown;
    const row = ruleToRow(created);
    if (!row) {
      return { ok: false, reason: 'rejected', status: 502 };
    }
    return { ok: true, alert: row };
  } catch {
    return { ok: false, reason: 'engine_unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

export type CancelAlertResult =
  | { ok: true }
  | { ok: false; reason: 'engine_unavailable' | 'not_found' | 'forbidden' | 'rejected'; status?: number };

/**
 * Cancel an armed alert by id. The userId is sent as a query param so
 * the engine can verify ownership before deleting (defense-in-depth;
 * the SIWS gate at the site boundary is the primary guard).
 */
export async function cancelAlertForWallet(
  wallet: string,
  alertId: string,
): Promise<CancelAlertResult> {
  if (!wallet || !alertId) return { ok: false, reason: 'rejected', status: 400 };

  const userId = walletToEngineUserId(wallet);
  const url =
    `${API_BASE}/v1/alerts/${encodeURIComponent(alertId)}` +
    `?userId=${encodeURIComponent(userId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      signal: controller.signal,
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (res.status === 404) return { ok: false, reason: 'not_found', status: 404 };
    if (res.status === 403) return { ok: false, reason: 'forbidden', status: 403 };
    if (!res.ok) return { ok: false, reason: 'rejected', status: res.status };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'engine_unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── translation ─────────────────────────── */

interface EngineAlertRule {
  id?: unknown;
  type?: unknown;
  enabled?: unknown;
  symbols?: unknown;
  priceAbove?: unknown;
  priceBelow?: unknown;
  label?: unknown;
  createdAt?: unknown;
  userId?: unknown;
  entryPrice?: unknown;
  leverage?: unknown;
  planId?: unknown;
  tradeDirection?: unknown;
  triggeredAt?: unknown;
  triggeredPrice?: unknown;
}

/** Window during which a fired alert is bucketed as "triggered" before
 *  it falls through to "resolved". 24h matches the section eyebrow in
 *  the alerts list ("Last 24h"). */
const TRIGGERED_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Map an engine `AlertRule` to a site `AlertRow`. Returns null when
 * the rule is shape-invalid or isn't a price-threshold.
 *
 * Status derivation:
 *   - has `triggeredAt` within 24h         → triggered
 *   - has `triggeredAt` ≥ 24h ago          → resolved
 *   - enabled = false                      → cancelled
 *   - else                                 → armed (LIVE)
 */
function ruleToRow(raw: unknown): AlertRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as EngineAlertRule;
  if (typeof r.id !== 'string') return null;
  if (r.type !== 'price_threshold') return null;

  const symbols = Array.isArray(r.symbols) ? r.symbols : [];
  const symbol = typeof symbols[0] === 'string' ? symbols[0].toUpperCase() : null;
  if (!symbol) return null;

  let direction: Direction | null = null;
  let price: number | null = null;
  if (typeof r.priceAbove === 'number' && Number.isFinite(r.priceAbove)) {
    direction = 'up';
    price = r.priceAbove;
  } else if (typeof r.priceBelow === 'number' && Number.isFinite(r.priceBelow)) {
    direction = 'down';
    price = r.priceBelow;
  }
  if (!direction || price === null) return null;

  const labelRaw = typeof r.label === 'string' ? r.label.toLowerCase().trim() : '';
  const kind: AlertKind =
    labelRaw.includes('entry')
      ? 'entry'
      : labelRaw.includes('tp1')
        ? 'tp1'
        : labelRaw.includes('tp2')
          ? 'tp2'
          : labelRaw.includes('sl')
            ? 'sl'
            : 'custom';

  const enabled = r.enabled === true || (r.enabled as unknown) === 1;
  const createdAtMs = typeof r.createdAt === 'number' ? r.createdAt : Date.now();
  const triggeredAtMs =
    typeof r.triggeredAt === 'number' && Number.isFinite(r.triggeredAt)
      ? r.triggeredAt
      : null;

  let status: AlertStatus;
  if (triggeredAtMs !== null) {
    status =
      Date.now() - triggeredAtMs < TRIGGERED_WINDOW_MS ? 'triggered' : 'resolved';
  } else if (!enabled) {
    status = 'cancelled';
  } else {
    status = 'armed';
  }

  const tradeDir = r.tradeDirection;

  return {
    id: r.id,
    symbol,
    direction,
    price,
    kind,
    status,
    armedAt: new Date(createdAtMs).toISOString(),
    triggeredAt: triggeredAtMs !== null ? new Date(triggeredAtMs).toISOString() : undefined,
    triggeredPrice:
      typeof r.triggeredPrice === 'number' && Number.isFinite(r.triggeredPrice)
        ? r.triggeredPrice
        : undefined,
    entryPrice:
      typeof r.entryPrice === 'number' && Number.isFinite(r.entryPrice)
        ? r.entryPrice
        : undefined,
    leverage:
      typeof r.leverage === 'number' && Number.isFinite(r.leverage) && r.leverage > 0
        ? r.leverage
        : undefined,
    planId: typeof r.planId === 'string' ? r.planId : undefined,
    tradeDirection: tradeDir === 'long' || tradeDir === 'short' ? tradeDir : undefined,
  };
}

const SYMBOL_RE = /^[A-Z0-9]{2,10}$/;
const VALID_KINDS: ReadonlySet<AlertKind> = new Set([
  'entry',
  'tp1',
  'tp2',
  'sl',
  'custom',
]);

function isValidArmInput(input: ArmAlertInput): boolean {
  if (!input || typeof input !== 'object') return false;
  if (typeof input.symbol !== 'string') return false;
  if (!SYMBOL_RE.test(input.symbol.toUpperCase())) return false;
  if (!VALID_KINDS.has(input.kind)) return false;
  if (input.direction !== 'up' && input.direction !== 'down') return false;
  if (!Number.isFinite(input.price)) return false;
  if (input.price <= 0) return false;
  return true;
}
