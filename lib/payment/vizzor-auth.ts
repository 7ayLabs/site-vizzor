// ---------------------------------------------------------------------------
// Vizzor-Auth token verifier — port of the engine's
// `src/api/auth/wallet-auth.ts`. The token shape is intentionally identical
// so a token minted by either side verifies on the other.
//
// Token format (no JWT lib, by design):
//   <base64url(payload)>.<base64url(HMAC-SHA256(secret, payload))>
// Payload: {
//   wallet: string,        // Solana address (base58)
//   tier:   'free'|'trial'|'pro'|'elite'|'lifetime',
//   iat:    number,        // issued-at, epoch seconds
//   exp:    number,        // expires-at, epoch seconds
//   v:      1              // schema version
// }
//
// Both the site (CLI thin-client `/api/v1/chat`) and the engine share
// `VIZZOR_AUTH_SECRET`. The secret never travels over the wire — only the
// HMAC does. Rotate by setting a new secret + accepting both during a
// short cutover (not implemented v1).
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from 'node:crypto';

export type VizzorTier = 'free' | 'trial' | 'pro' | 'elite' | 'lifetime';

const TIER_VALUES = new Set<VizzorTier>(['free', 'trial', 'pro', 'elite', 'lifetime']);
const TOKEN_SCHEMA_VERSION = 1;
const CLOCK_SKEW_SECONDS = 1;
const MAX_TOKEN_LIFETIME_SECONDS = 60 * 60 * 24;

export interface VizzorAuthPayload {
  wallet: string;
  tier: VizzorTier;
  iat: number;
  exp: number;
  v: number;
}

export interface VizzorAuthInfo {
  walletAddress: string;
  tier: VizzorTier;
  expiresAt: number;
}

export interface VerifyResult {
  ok: true;
  info: VizzorAuthInfo;
}

export interface VerifyError {
  ok: false;
  reason:
    | 'no_secret_configured'
    | 'malformed'
    | 'bad_signature'
    | 'expired'
    | 'unsupported_version'
    | 'invalid_payload';
}

export function verifyVizzorAuthToken(
  token: string,
  secret: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult | VerifyError {
  if (!secret || secret.length === 0) {
    return { ok: false, reason: 'no_secret_configured' };
  }

  // Accept either bare `<payload>.<sig>` or `vizzor_auth_v1.<payload>.<sig>`.
  // The CLI strips the prefix before sending but a misconfigured caller might
  // forward it verbatim; we tolerate both rather than 400 on a copy/paste.
  const stripped = token.startsWith('vizzor_auth_v1.') ? token.slice(15) : token;
  const lastDot = stripped.lastIndexOf('.');
  if (lastDot <= 0 || lastDot >= stripped.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const payloadB64 = stripped.slice(0, lastDot);
  const sigB64 = stripped.slice(lastDot + 1);

  // Recompute the HMAC and compare in constant time.
  const expectedSig = createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');
  const expectedBuf = Buffer.from(expectedSig);
  const providedBuf = Buffer.from(sigB64);
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Parse the payload and validate the fields.
  let payload: VizzorAuthPayload;
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    payload = JSON.parse(json) as VizzorAuthPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.v !== TOKEN_SCHEMA_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }
  if (
    typeof payload.wallet !== 'string' ||
    payload.wallet.length === 0 ||
    typeof payload.tier !== 'string' ||
    !TIER_VALUES.has(payload.tier) ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    payload.exp <= payload.iat
  ) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SECONDS) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    info: {
      walletAddress: payload.wallet,
      tier: payload.tier,
      expiresAt: payload.exp,
    },
  };
}
