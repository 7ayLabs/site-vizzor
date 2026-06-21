/**
 * Centralised support-facing error codes.
 *
 * Every code is `VZ-<domain>-<NNN>` where:
 *   VZ      = brand prefix, lets support filter inbound messages
 *   domain  = subsystem the error originated in (`WAL` wallet, `PAY`
 *             payment, `API` api/upstream, `SES` SIWS session, ...)
 *   NNN     = stable three-digit ordinal inside the domain. Once
 *             assigned, the code never changes meaning — even if the
 *             user-facing copy is reworded, support can still trace
 *             the report back to a specific line of code.
 *
 * The mapping is keyed by the camelCase identifier the code throws —
 * which is the same key the modal already uses to look up the
 * translated copy in `messages/*.json` — so adding a new error
 * means: throw the code, add it here, add the copy. The user-visible
 * chip is built from the same source so support and product never
 * drift apart.
 */

export interface SupportCode {
  /** Stable public identifier (`VZ-WAL-001`). */
  code: string;
  /** Short slug suitable for log scraping / GitHub issue titles. */
  slug: string;
}

const WALLET: Record<string, SupportCode> = {
  wallet_not_installed: { code: 'VZ-WAL-001', slug: 'wallet-not-installed' },
  user_rejected:        { code: 'VZ-WAL-002', slug: 'user-rejected' },
  stale_session:        { code: 'VZ-WAL-003', slug: 'stale-session' },
  nonce_failed:         { code: 'VZ-WAL-004', slug: 'siws-nonce-failed' },
  verify_failed:        { code: 'VZ-WAL-005', slug: 'siws-verify-failed' },
  wrong_chain:          { code: 'VZ-WAL-006', slug: 'wrong-chain' },
  unknown:              { code: 'VZ-WAL-099', slug: 'wallet-unknown' },
};

const WALLET_CALLBACK: Record<string, SupportCode> = {
  wallet_rejected:                 { code: 'VZ-WAL-010', slug: 'mobile-rejected' },
  handoff_missing:                 { code: 'VZ-WAL-011', slug: 'mobile-handoff-missing' },
  connect_params_missing:          { code: 'VZ-WAL-012', slug: 'mobile-connect-params-missing' },
  sign_params_missing:             { code: 'VZ-WAL-013', slug: 'mobile-sign-params-missing' },
  shared_secret_missing:           { code: 'VZ-WAL-014', slug: 'mobile-shared-secret-missing' },
  unknown_step:                    { code: 'VZ-WAL-015', slug: 'mobile-unknown-step' },
  decrypt_failed:                  { code: 'VZ-WAL-016', slug: 'mobile-decrypt-failed' },
  connect_payload_missing_fields:  { code: 'VZ-WAL-017', slug: 'mobile-connect-payload-malformed' },
  signature_missing:               { code: 'VZ-WAL-018', slug: 'mobile-signature-missing' },
  nonce_failed:                    { code: 'VZ-WAL-019', slug: 'mobile-nonce-failed' },
  verify_failed:                   { code: 'VZ-WAL-020', slug: 'mobile-verify-failed' },
  unknown:                         { code: 'VZ-WAL-099', slug: 'wallet-unknown' },
};

const UNKNOWN: SupportCode = { code: 'VZ-GEN-099', slug: 'unknown' };

export function walletConnectCode(key: string): SupportCode {
  return WALLET[key] ?? UNKNOWN;
}

export function walletCallbackCode(key: string): SupportCode {
  return WALLET_CALLBACK[key] ?? UNKNOWN;
}
