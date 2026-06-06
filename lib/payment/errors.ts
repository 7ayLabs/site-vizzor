/**
 * Centralized payment-failure taxonomy.
 *
 * Every failure reason emitted by the payment subsystem (the two
 * payment-session route handlers, the upstream `createSession` /
 * `getSession` helpers, the on-chain watcher, and the wallet adapter)
 * is enumerated here. The discriminated union is the only place the
 * full list lives — the UI consumes it through `mapReasonToCopyKey()`
 * and `classifyReason()`, never by string-matching ad-hoc.
 *
 * Two axes drive UI behavior:
 *
 *   1. The i18n key under `pay.error.*` — full user-facing copy.
 *   2. The `ReasonClass` — drives banner tone and the CTA shape:
 *        - 'infra-pending' → neutral info banner with a "Pay in
 *           Telegram" fallback CTA. Not a true failure; the engine /
 *           feature flag isn't deployed yet.
 *        - 'transient'     → amber/pending banner. Retry is the right
 *           action; the underlying cause is expected to clear.
 *        - 'fatal'         → red error banner. Retry will not fix it
 *           without operator or user intervention.
 *        - 'user-action'   → amber banner with no Retry — the user
 *           must take an action (connect wallet, switch chain).
 *
 * Whenever a new failure reason is added to a route handler, it MUST
 * be added here in the same PR so the UI surfaces a real message
 * instead of falling through to `unknown_reason`.
 */

/**
 * The full enumeration of every reason emitted by the payment surface.
 *
 * Sources:
 *   - app/api/payment/session/route.ts
 *   - app/api/payment/session/[id]/route.ts
 *   - lib/payment/session.ts (SessionFailure type)
 *   - components/pay/checkout-shell.tsx (client-side polling + wallet)
 *   - components/pay/vizzor-pay-button.tsx, ton-connect-button.tsx
 *   - lib/feature-flags.ts (off → 'feature_disabled')
 */
export type PaymentReason =
  // Session-creation reasons (POST /api/payment/session).
  | 'invalid_body'
  | 'invalid_input'
  | 'invalid_tier_cadence'
  | 'unsupported_chain'
  | 'price_lookup_failed'
  | 'session_failed'
  | 'feature_disabled'
  | 'rate_unavailable'
  // Session-poll reasons (GET /api/payment/session/[id]).
  | 'engine_marked_failed'
  // Legacy v0.1.0 names that pre-date site-owned sessions but might
  // still appear if any external caller proxies them through. Kept so
  // banners never fall through to 'unknown_reason' on a known token.
  | 'engine_error'
  | 'engine_offline'
  // Wallet-side reasons (client surface).
  | 'wallet_not_connected'
  | 'wallet_rejected'
  | 'mint_not_configured'
  // Catch-all. Always last in chain so the UI shows a coherent fallback.
  | 'unknown_reason';

/** Behavioral class — drives banner tone and CTA. */
export type ReasonClass =
  | 'infra-pending'
  | 'transient'
  | 'fatal'
  | 'user-action';

interface ReasonDescriptor {
  /** i18n key suffix under `pay.error.*`. */
  copyKey: string;
  klass: ReasonClass;
}

const REASON_TABLE: Readonly<Record<PaymentReason, ReasonDescriptor>> = {
  // Infra-pending: feature flag off, engine not yet deployed.
  feature_disabled: { copyKey: 'featureDisabled', klass: 'infra-pending' },
  engine_offline: { copyKey: 'engineOffline', klass: 'infra-pending' },
  engine_error: { copyKey: 'engineError', klass: 'infra-pending' },
  mint_not_configured: {
    copyKey: 'mintNotConfigured',
    klass: 'infra-pending',
  },

  // Transient: retry is the right action.
  rate_unavailable: { copyKey: 'rateUnavailable', klass: 'transient' },
  session_failed: { copyKey: 'sessionFailed', klass: 'transient' },
  engine_marked_failed: {
    copyKey: 'engineMarkedFailed',
    klass: 'transient',
  },

  // Fatal: bad request shape — retry alone won't fix it.
  invalid_body: { copyKey: 'invalidInput', klass: 'fatal' },
  invalid_input: { copyKey: 'invalidInput', klass: 'fatal' },
  invalid_tier_cadence: { copyKey: 'invalidInput', klass: 'fatal' },
  unsupported_chain: { copyKey: 'unsupportedChain', klass: 'fatal' },
  price_lookup_failed: { copyKey: 'priceLookup', klass: 'fatal' },

  // User-action: the user must do something before retry is possible.
  wallet_not_connected: {
    copyKey: 'walletNotConnected',
    klass: 'user-action',
  },
  wallet_rejected: { copyKey: 'walletRejected', klass: 'user-action' },

  // Fallback.
  unknown_reason: { copyKey: 'unknown', klass: 'fatal' },
};

const ALL_REASONS: ReadonlySet<PaymentReason> = new Set(
  Object.keys(REASON_TABLE) as PaymentReason[],
);

/** Type-narrowing guard — every other call site can rely on PaymentReason. */
export function isKnownReason(value: string | undefined): value is PaymentReason {
  return value !== undefined && ALL_REASONS.has(value as PaymentReason);
}

/** Always returns a PaymentReason. Unknown inputs map to 'unknown_reason'. */
export function normalizeReason(value: string | undefined): PaymentReason {
  if (value === undefined) return 'unknown_reason';
  return isKnownReason(value) ? value : 'unknown_reason';
}

/** Full descriptor for a reason. Unknown inputs fall back to 'unknown_reason'. */
export function describeReason(value: string | undefined): ReasonDescriptor {
  return REASON_TABLE[normalizeReason(value)];
}

/** Behavioral class for a reason — drives banner tone and CTA. */
export function classifyReason(value: string | undefined): ReasonClass {
  return describeReason(value).klass;
}

/**
 * i18n key for a reason. The full key is `pay.error.${copyKey}`; the
 * caller composes it. Returning just the suffix lets the caller bind
 * to the `pay.error` namespace directly via `useTranslations('pay.error')`.
 */
export function mapReasonToCopyKey(value: string | undefined): string {
  return describeReason(value).copyKey;
}
