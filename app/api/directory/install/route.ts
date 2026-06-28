/**
 * POST /api/directory/install — install a connector / plugin for the
 * authenticated wallet.
 *
 * Body: { connector_id: string, credentials?: object }
 *
 * Flow:
 *   1. SIWS gate via getActiveSession.
 *   2. Rate limit (5/min per IP).
 *   3. Look up the catalog entry; unknown id → 400 unknown_connector.
 *   4. Validate the credentials payload against the entry's
 *      config_schema. Errors normalize to { reason: 'invalid_<field>' }.
 *   5. SSRF-guard any URL fields (validateOutboundUrl).
 *   6. Encrypt the serialized payload (AES-256-GCM) — secrets never
 *      hit disk in plaintext.
 *   7. Insert the row and audit-log the install event.
 *
 * Skills have no credentials and no DB row — install is a no-op for
 * them. The user activates a skill via PATCH /skills/active.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import { getEntry } from '@/lib/directory/catalog';
import {
  validateInstallPayload,
  serializeForEncryption,
  InstallValidationError,
} from '@/lib/directory/validate';
import { encrypt } from '@/lib/security/connector-crypto';
import { validateOutboundUrl, SsrfBlockedError } from '@/lib/security/safe-fetch';
import { insertUserConnection } from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'directory.write');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }

  let body: { connector_id?: unknown; credentials?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400 },
    );
  }
  if (typeof body.connector_id !== 'string') {
    return NextResponse.json(
      { ok: false, reason: 'missing_connector_id' },
      { status: 400 },
    );
  }
  const entry = getEntry(body.connector_id);
  if (!entry) {
    return NextResponse.json(
      { ok: false, reason: 'unknown_connector' },
      { status: 400 },
    );
  }

  // Skill installs are pure activation — no DB row needed. The active
  // skill pointer is set via PATCH /skills/active. Return ok so the UI
  // can treat the entry as recognized.
  if (entry.install_kind === 'skill' || entry.install_kind === 'internal') {
    recordAudit({
      eventType: 'directory.install',
      actor: actorFromWallet(session.wallet),
      subject: entry.id,
      outcome: 'ok',
      req,
    });
    return NextResponse.json({ ok: true, install_id: null });
  }

  // Validate credentials.
  let validated: Record<string, string> | null;
  try {
    validated = validateInstallPayload(entry, body.credentials);
  } catch (err) {
    const reason = err instanceof InstallValidationError ? err.reason : 'invalid_credentials';
    recordAudit({
      eventType: 'directory.install',
      actor: actorFromWallet(session.wallet),
      subject: entry.id,
      outcome: 'denied',
      req,
    });
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }
  if (!validated) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_credentials' },
      { status: 400 },
    );
  }

  // SSRF-guard URL fields before they ever reach the encrypted blob.
  // Defense-in-depth: even if the attacker bypasses the regex, the
  // hostname must resolve to a public IP.
  for (const field of entry.config_schema?.fields ?? []) {
    const fieldValue = validated[field.name];
    if (field.kind === 'url' && fieldValue) {
      try {
        await validateOutboundUrl(fieldValue);
      } catch (err) {
        const reason = err instanceof SsrfBlockedError ? 'ssrf_blocked' : 'invalid_url';
        recordAudit({
          eventType: 'directory.install',
          actor: actorFromWallet(session.wallet),
          subject: entry.id,
          outcome: 'denied',
          req,
        });
        return NextResponse.json({ ok: false, reason }, { status: 400 });
      }
    }
  }

  const blob = encrypt(serializeForEncryption(validated));
  const installId = `conn_${randomUUID().replace(/-/g, '')}`;
  try {
    insertUserConnection({
      id: installId,
      wallet: session.wallet,
      connectorId: entry.id,
      scopes: entry.scopes,
      ciphertext: blob.ciphertext,
      iv: blob.iv,
      tag: blob.tag,
    });
  } catch (err) {
    // Unique index violation = duplicate active install. Surface a
    // user-friendly reason without leaking the SQL.
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      return NextResponse.json(
        { ok: false, reason: 'already_installed' },
        { status: 409 },
      );
    }
    throw err;
  }

  recordAudit({
    eventType: 'directory.install',
    actor: actorFromWallet(session.wallet),
    subject: entry.id,
    outcome: 'ok',
    req,
  });

  return NextResponse.json({ ok: true, install_id: installId });
}
