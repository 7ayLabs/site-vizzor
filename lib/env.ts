/**
 * Production env-var validation.
 *
 * Reads the set of env vars that a v0.2.0 production deployment requires
 * and throws a clear error if any are missing. Wired into route modules
 * that fail unsafely when misconfigured — predict (which depends on the
 * engine URL and on Solana RPC for burn verification) and the payment
 * session routes (which depend on the treasury addresses and the SQLite
 * DB path).
 *
 * Two design choices:
 *
 *   1. Validation runs at module load (top-level), not per-request. A
 *      misconfigured production instance fails on first import, which
 *      Next.js will surface as a 500 on the first hit to the affected
 *      route. That is louder than a silent fallback and quieter than
 *      crashing the entire server (the marketing pages remain
 *      serveable).
 *
 *   2. NODE_ENV gates the check. Dev and CI deliberately tolerate
 *      missing vars — the fallback chain in lib/payment/watcher.ts and
 *      lib/payment/treasury.ts handles them. Production is the only
 *      regime that fails fast.
 */

export interface EnvRequirement {
  /** The env-var name. */
  name: string;
  /** Why it is required; surfaced in the error message. */
  rationale: string;
}

/**
 * Asserts that every entry in `required` is set in `process.env` when
 * NODE_ENV is `production`. Throws a single aggregated error listing
 * every missing var when at least one is missing.
 *
 * Outside production this is a no-op.
 */
export function assertRequiredEnv(
  context: string,
  required: readonly EnvRequirement[],
): void {
  if (process.env.NODE_ENV !== 'production') return;
  // Skip during `next build`'s page-data collection. NEXT_PHASE is
  // 'phase-production-build' while the build worker imports the
  // route module to extract metadata — at that point the runtime
  // env (treasury addresses, RPC URLs, etc.) is intentionally not
  // present. The same module loaded at request time WILL see the
  // injected env and assert correctly.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const missing = missingRequiredEnv(required);
  if (missing.length === 0) return;
  const lines = missing.map((m) => `  - ${m.name}: ${m.rationale}`);
  throw new Error(
    `[vizzor-env:${context}] ${missing.length} required env var(s) missing in production:\n` +
      lines.join('\n') +
      '\nSee docs/ops/secrets.md for provisioning instructions.',
  );
}

/**
 * Non-throwing variant — returns the list of missing requirements
 * instead of throwing. Route handlers use this at request time so a
 * misconfigured prod returns a structured JSON error (with a clear
 * `payment_misconfigured` reason and the missing var names) rather
 * than crashing module load and serving a raw "Internal Server
 * Error" with no JSON body. The asserting variant stays as the
 * defense-in-depth signal for deploys that wire the route module in
 * at boot — when missing-env conditions are surfaced loudly to ops.
 */
export function missingRequiredEnv(
  required: readonly EnvRequirement[],
): EnvRequirement[] {
  const missing: EnvRequirement[] = [];
  for (const req of required) {
    const val = process.env[req.name];
    if (val === undefined || val === null || val === '') {
      missing.push(req);
    }
  }
  return missing;
}

/* ------------------------------------------------------------------ *\
 * Pre-defined requirement bundles per route surface.
 *
 * Keep these declarative so reviewers can grep for the env vars each
 * route depends on without spelunking through call graphs.
\* ------------------------------------------------------------------ */

export const PREDICT_ROUTE_REQUIREMENTS: readonly EnvRequirement[] = [
  {
    name: 'VIZZOR_API_URL',
    rationale: 'engine endpoint that /api/predict proxies to',
  },
];

/**
 * Hard requirements for the payment-session route — env vars without
 * a runtime fallback in `lib/payment/treasury.ts` or `lib/solana.ts`.
 *
 * The SOL treasury + RPC are intentionally NOT in this list: the
 * runtime resolvers fall back through a chain of env-var names
 * (cluster-specific → generic → safe defaults / pre-derived pool →
 * legacy static treasury). A missing literal `VIZZOR_SOLANA_TREASURY`
 * is fine as long as one of `VIZZOR_SOLANA_TREASURY_MAINNET` /
 * `_DEVNET` / `_TESTNET` is set, or the address-pool env is set
 * instead. Listing the literal here would falsely block sessions
 * whose downstream resolver would have succeeded.
 *
 * Same reasoning for `SOLANA_RPC_URL` — staging uses the
 * cluster-specific `SOLANA_RPC_URL_DEVNET` variant.
 *
 * What stays here: `VIZZOR_SITE_DB`, which has no fallback. Without
 * it the SQLite writer would silently write to the container's
 * ephemeral CWD and lose every payment on container recreate.
 */
export const PAYMENT_SESSION_ROUTE_REQUIREMENTS: readonly EnvRequirement[] = [
  {
    name: 'VIZZOR_SITE_DB',
    rationale:
      'SQLite path for payment_sessions/subscriptions; must point inside the persistent volume',
  },
];

/**
 * Per-chain requirement bundle for TON. Checked at REQUEST time
 * (only when chain === 'ton'). Same fallback-aware reasoning as the
 * SOL list — none of the TON env vars are absolute requirements at
 * the env-check layer; the runtime resolver chooses between
 * `VIZZOR_TON_TREASURY_MAINNET` / `_TESTNET` and the address pool.
 * The chain-specific RPC URL resolver in `lib/ton.ts` falls back
 * through cluster-specific → generic → public toncenter so a
 * configured `VIZZOR_TON_RPC_URL_TESTNET` is enough on staging.
 */
export const PAYMENT_TON_ROUTE_REQUIREMENTS: readonly EnvRequirement[] = [];
