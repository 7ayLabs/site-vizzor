/**
 * Audit log for PII-touching reads and writes.
 *
 * Every bot-authenticated route that reveals or mutates user-bound
 * data (subscription lookups, grant redemptions, wallet-link writes,
 * account deletions) records one row here. The log itself is
 * privacy-respecting: subjects (telegram_user_id, wallet_address) are
 * SHA-256-hashed before persistence, IPs and User-Agents go through
 * the same HMAC hash used by the rate-limiter. An attacker who steals
 * the audit log obtains correlation IDs they cannot reverse.
 *
 * Retention is 1 year via the daily sweep (`lib/payment/retention.ts`).
 *
 * Read path: the operator runbook (`docs/ops/runbook-security-incident.md`)
 * documents `sqlite3 .vizzor/site.db 'SELECT … FROM audit_log WHERE …'`
 * queries for incident response — for example, "did unauthorized
 * callers enumerate subscription lookups during the window of the
 * leaked bot-secret?".
 */

import { createHash } from 'node:crypto';
import { getDb } from './db';
import { getClientIp, hashClientIp } from './client-ip';

export type AuditEventType =
  | 'subscription.lookup'
  | 'subscription.cancel'
  | 'subscription.downgrade'
  | 'grant.redeem'
  | 'wallet_link.create'
  | 'wallet_link.delete'
  | 'account.delete'
  | 'retention.sweep'
  // v0.4.1 — directory (connector store) events. `subject` is the
  // connector_id from data/connectors.json; never a credential.
  | 'directory.install'
  | 'directory.uninstall'
  | 'directory.credentials.rotated'
  | 'directory.skill.activated'
  | 'directory.connector.circuit_open';

export type AuditOutcome = 'found' | 'not_found' | 'denied' | 'ok' | 'error';

export interface AuditRecordInput {
  eventType: AuditEventType;
  /** 'bot' | 'wallet:<hex-hash-prefix>' | 'system' */
  actor: string;
  /**
   * Raw subject identifier (`telegram_user_id` as a string, or the
   * wallet address). Hashed inside this helper — never written raw.
   */
  subject?: string | number | null;
  outcome: AuditOutcome;
  /** The originating request, if any — used to hash IP + UA. */
  req?: Request;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function maybeHashSubject(
  subject: AuditRecordInput['subject'],
): string | null {
  if (subject === null || subject === undefined) return null;
  return sha256Hex(String(subject));
}

function maybeHashUa(req: Request | undefined): string | null {
  if (!req) return null;
  const ua = req.headers.get('user-agent') ?? '';
  if (ua.length === 0) return null;
  // Truncate before hashing — full UA strings are an entropy source
  // for browser fingerprinting; we only care about coarse-grained
  // correlation (Chrome vs curl vs the bot).
  return sha256Hex(ua.slice(0, 256)).slice(0, 32);
}

/**
 * Append a row to the audit log. Best-effort: a failure does NOT
 * block the calling route — the route's primary outcome is more
 * important than the audit trail integrity for a single request, and
 * a separate health probe should flag a chronically-failing log.
 */
export function recordAudit(input: AuditRecordInput): void {
  try {
    const ipHash = input.req ? hashClientIp(getClientIp(input.req)) : null;
    const uaHash = maybeHashUa(input.req);
    getDb()
      .prepare(
        `INSERT INTO audit_log
          (occurred_at, event_type, actor, subject_hash, outcome, ip_hash, ua_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Date.now(),
        input.eventType,
        input.actor,
        maybeHashSubject(input.subject),
        input.outcome,
        ipHash,
        uaHash,
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[audit] write failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Hash a wallet address into the short prefix used as the `actor`
 * field for SIWS-authenticated routes (e.g., `/api/account/delete`).
 * Keeps the actor identifiable across the same wallet's calls without
 * persisting the raw address into the audit table.
 */
export function actorFromWallet(wallet: string): string {
  return `wallet:${sha256Hex(wallet).slice(0, 16)}`;
}
