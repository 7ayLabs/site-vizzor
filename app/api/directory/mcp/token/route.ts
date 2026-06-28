/**
 * Personal MCP token surface — Vizzor as an MCP server.
 *
 *   GET    list active tokens for the wallet (sans the raw token,
 *          which is shown only once at mint time).
 *   POST   mint a new token. Body: { label?, expires_in_days? }.
 *          Returns the raw token ONCE; the DB stores only sha256.
 *   DELETE revoke by token_hash (soft).
 *
 * The actual `/v1/mcp/*` endpoints aren't live in v0.4.1 — the token
 * surface ships now so the catalog's MCP entry has somewhere to put
 * the user's credential when they're ready to wire Claude Desktop /
 * Cursor / etc. Day-1 MCP launch is just a config snippet copy
 * instead of a new auth surface.
 *
 * Gated by `directory.mcp.token` rate-limit (5/min/wallet) and
 * required_tier 'elite' (matches the catalog entry — MCP is the v0.4.1
 * expression of the pricing page's 'REST API + priority queue' allowance).
 */

import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import {
  insertMcpToken,
  listMcpTokensForWallet,
  revokeMcpToken,
} from '@/lib/payment/db';
import { resolveTier } from '@/lib/payment/tier-resolver';
import { tierGateForEntry } from '@/lib/directory/runtime';
import { getEntry } from '@/lib/directory/catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 365;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function gateOrNull(wallet: string): NextResponse | null {
  const entry = getEntry('vizzor-mcp');
  if (!entry) return null;
  if (tierGateForEntry(entry, resolveTier(wallet))) {
    return NextResponse.json(
      { ok: false, reason: 'tier_required', required_tier: entry.required_tier },
      { status: 402 },
    );
  }
  return null;
}

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'directory.read');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }
  const tokens = listMcpTokensForWallet(session.wallet).map((row) => ({
    token_hash: row.token_hash,
    label: row.label,
    scopes: JSON.parse(row.scopes) as string[],
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
  }));
  return NextResponse.json(
    { ok: true, tokens },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

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
  const gated = gateOrNull(session.wallet);
  if (gated) return gated;

  let body: { label?: unknown; expires_in_days?: unknown };
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }
  const label =
    typeof body.label === 'string' && body.label.trim().length > 0
      ? body.label.trim().slice(0, 64)
      : null;
  const requestedDays =
    typeof body.expires_in_days === 'number' &&
    Number.isFinite(body.expires_in_days)
      ? Math.min(Math.max(1, Math.floor(body.expires_in_days)), MAX_EXPIRY_DAYS)
      : DEFAULT_EXPIRY_DAYS;
  const expiresAt = Date.now() + requestedDays * DAY_MS;

  // 32 random bytes encoded as hex = 64 chars. Prefixed `vzr_` so the
  // engine + agent config can recognize the token shape at a glance.
  const raw = `vzr_${randomBytes(32).toString('hex')}`;
  insertMcpToken({
    tokenHash: hashToken(raw),
    wallet: session.wallet,
    label,
    scopes: ['predict.read'],
    expiresAt,
  });

  recordAudit({
    eventType: 'directory.install',
    actor: actorFromWallet(session.wallet),
    subject: 'vizzor-mcp',
    outcome: 'ok',
    req,
  });

  return NextResponse.json(
    {
      ok: true,
      // The ONLY time the raw token leaves the server. The UI must
      // surface it once and store nothing — the user is responsible
      // for putting it in their agent's config.
      token: raw,
      label,
      scopes: ['predict.read'],
      expires_at: expiresAt,
      // Sample config the UI copies to the user's clipboard. The actual
      // /v1/mcp endpoint is deferred — when it ships the user only
      // needs to flip the env var, no re-pairing.
      claude_desktop_config: {
        mcpServers: {
          vizzor: {
            command: 'npx',
            args: ['-y', '@vizzor/mcp-client'],
            env: { VIZZOR_TOKEN: raw },
          },
        },
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function DELETE(req: Request) {
  const limited = enforceRateLimit(req, 'directory.write');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get('token_hash');
  if (!tokenHash || !/^[a-f0-9]{64}$/.test(tokenHash)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_token_hash' },
      { status: 400 },
    );
  }
  const ok = revokeMcpToken(tokenHash, session.wallet);
  if (!ok) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404 },
    );
  }
  recordAudit({
    eventType: 'directory.uninstall',
    actor: actorFromWallet(session.wallet),
    subject: 'vizzor-mcp',
    outcome: 'ok',
    req,
  });
  return NextResponse.json({ ok: true });
}
