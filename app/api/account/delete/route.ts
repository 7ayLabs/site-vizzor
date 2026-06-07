/**
 * POST /api/account/delete — GDPR / CCPA right to erasure.
 *
 * Authenticated by the SIWS-derived auth-session cookie — only the
 * wallet whose data is being deleted can authorize the deletion. The
 * underlying authentication mechanism (the wallet signed the SIWS
 * `Login` message at session creation) is a strong proof of control.
 *
 * Effects:
 *   - DELETE the `wallet_links` row (permanent binding removed).
 *   - NULL `subscriptions.telegram_user_id` and replace
 *     `subscriptions.wallet_address` with a one-way tombstone so the
 *     subscription record can no longer be correlated to the wallet.
 *   - Scrub `payment_sessions.payer_address` for non-confirmed rows
 *     (the failed/expired ones carry no audit value). Confirmed rows
 *     are retained for tax/accounting per the privacy policy.
 *   - DELETE all `auth_sessions` rows for the wallet.
 *   - Append a hashed `account.delete` row to the audit log.
 *
 * All steps run inside a single `db.transaction` so a crash mid-flow
 * rolls back cleanly.
 *
 * Response: `{ ok: true, deleted: { table: count, … }, retained: […],
 *             retainedReason: '…' }`
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { checkOrigin } from '@/lib/payment/origin-check';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import { getDb } from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DeletionReport {
  ok: true;
  deleted: Record<string, number>;
  retained: string[];
  retainedReason: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const origin = checkOrigin(req);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, reason: origin.reason },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const limited = enforceRateLimit(req, 'account.delete');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const wallet = session.wallet;
  const tombstone =
    'deleted:' + createHash('sha256').update(wallet).digest('hex').slice(0, 16);

  const db = getDb();
  const deleted: Record<string, number> = {
    wallet_links: 0,
    auth_sessions: 0,
    subscriptions_scrubbed: 0,
    payment_sessions_scrubbed: 0,
  };

  try {
    const tx = db.transaction(() => {
      deleted.wallet_links = db
        .prepare(`DELETE FROM wallet_links WHERE wallet_address = ?`)
        .run(wallet).changes;

      deleted.auth_sessions = db
        .prepare(`DELETE FROM auth_sessions WHERE wallet_address = ?`)
        .run(wallet).changes;

      deleted.subscriptions_scrubbed = db
        .prepare(
          `UPDATE subscriptions
             SET telegram_user_id = NULL,
                 wallet_address   = ?
           WHERE wallet_address = ?`,
        )
        .run(tombstone, wallet).changes;

      deleted.payment_sessions_scrubbed = db
        .prepare(
          `UPDATE payment_sessions
             SET payer_address = ?
           WHERE payer_address = ?
             AND status IN ('expired','failed','pending')`,
        )
        .run(tombstone, wallet).changes;
    });
    tx();
  } catch (err) {
    recordAudit({
      eventType: 'account.delete',
      actor: actorFromWallet(wallet),
      subject: wallet,
      outcome: 'error',
      req,
    });
    return NextResponse.json(
      {
        ok: false,
        reason: 'delete_failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  recordAudit({
    eventType: 'account.delete',
    actor: actorFromWallet(wallet),
    subject: wallet,
    outcome: 'ok',
    req,
  });

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  // Sign the user out — their session was just deleted from the DB
  // but the cookie still holds the raw token until the browser drops
  // it. Send the explicit clear so the page reloads as signed-out.
  // Clear BOTH possible cookie names (legacy + __Host-) so a user who
  // signed in pre-rotation has both purged.
  const isProd = process.env.NODE_ENV === 'production';
  const secure = isProd ? '; Secure' : '';
  const sameSite = isProd ? 'Strict' : 'Lax';
  headers.append(
    'Set-Cookie',
    `vizzor.auth=; Path=/; Max-Age=0; HttpOnly; SameSite=${sameSite}${secure}`,
  );
  headers.append(
    'Set-Cookie',
    `__Host-vizzor.auth=; Path=/; Max-Age=0; HttpOnly; SameSite=${sameSite}${secure}`,
  );

  const body: DeletionReport = {
    ok: true,
    deleted,
    retained: ['payment_sessions.confirmed'],
    retainedReason:
      'Confirmed payment records are retained for tax and audit compliance per /legal/privacy.',
  };

  return new NextResponse(JSON.stringify(body), { status: 200, headers });
}
