/**
 * DELETE /api/directory/install/[id] — soft-revoke an install.
 * PATCH  /api/directory/install/[id] — rotate the credentials.
 *
 * Both routes are wallet-scoped: the [id] parameter is matched against
 * the caller's wallet so one user can never revoke / rotate another's
 * connection regardless of guess attempts.
 */

import { NextResponse } from 'next/server';
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
import {
  getUserConnection,
  revokeUserConnection,
  rotateUserConnectionCredentials,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(req, 'directory.write');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  const ok = revokeUserConnection(id, session.wallet);
  if (!ok) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404 },
    );
  }
  recordAudit({
    eventType: 'directory.uninstall',
    actor: actorFromWallet(session.wallet),
    subject: id,
    outcome: 'ok',
    req,
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(req, 'directory.write');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  const row = getUserConnection(id, session.wallet);
  if (!row || row.status !== 'active') {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404 },
    );
  }
  const entry = getEntry(row.connector_id);
  if (!entry || !entry.config_schema) {
    return NextResponse.json(
      { ok: false, reason: 'not_rotatable' },
      { status: 400 },
    );
  }

  let body: { credentials?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400 },
    );
  }

  let validated: Record<string, string> | null;
  try {
    validated = validateInstallPayload(entry, body.credentials);
  } catch (err) {
    const reason = err instanceof InstallValidationError ? err.reason : 'invalid_credentials';
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }
  if (!validated) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_credentials' },
      { status: 400 },
    );
  }

  for (const field of entry.config_schema.fields) {
    const fieldValue = validated[field.name];
    if (field.kind === 'url' && fieldValue) {
      try {
        await validateOutboundUrl(fieldValue);
      } catch (err) {
        const reason = err instanceof SsrfBlockedError ? 'ssrf_blocked' : 'invalid_url';
        return NextResponse.json({ ok: false, reason }, { status: 400 });
      }
    }
  }

  const blob = encrypt(serializeForEncryption(validated));
  rotateUserConnectionCredentials(id, session.wallet, blob.ciphertext, blob.iv, blob.tag);
  recordAudit({
    eventType: 'directory.credentials.rotated',
    actor: actorFromWallet(session.wallet),
    subject: id,
    outcome: 'ok',
    req,
  });
  return NextResponse.json({ ok: true });
}
