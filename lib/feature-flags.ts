/**
 * Feature flags — single source of truth for runtime toggles.
 *
 * All flags are read from `process.env`. Public flags use the
 * `NEXT_PUBLIC_*` prefix so they're inlined into the client bundle at
 * build time; private flags (none yet) would stay server-only.
 *
 * Phase 1 ships with `isTokenLive()` returning false — the paid path
 * exists in code but renders a "launching soon" panel until the
 * $VIZZOR contract is on-chain and `NEXT_PUBLIC_TOKEN_LIVE=true`.
 */

const DEFAULT_FREE_PREDICTIONS = 3;

export function isTokenLive(): boolean {
  return process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';
}

export function freePredictions(): number {
  const raw = process.env.NEXT_PUBLIC_FREE_PREDICTIONS;
  if (!raw) return DEFAULT_FREE_PREDICTIONS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FREE_PREDICTIONS;
}
