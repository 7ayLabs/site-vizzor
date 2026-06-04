/**
 * Solana shared constants and env-driven config.
 *
 * Safe to import from BOTH client and server code. Server-only burn
 * verification lives in `lib/solana-server.ts` because it pulls in the
 * persistent replay cache (SQLite via `better-sqlite3` → node:fs),
 * which webpack cannot bundle for the client. Splitting the modules
 * keeps client components (`burn-button`, `vizzor-pay-button`,
 * `wallet-provider`, `quota-sidebar`) free of server-only deps.
 *
 * RPC: server-side `SOLANA_RPC_URL` (Helius free tier recommended).
 * Constants come from `NEXT_PUBLIC_*` env vars so the same values are
 * visible to client code that builds the burn tx in the first place.
 */

// Well-known burn destination on Solana. No private key exists for this
// address (it's vanity-derived around the prefix "1nc1nerator"), so any
// tokens sent here are unrecoverable.
export const INCINERATOR_ADDRESS = '1nc1nerator11111111111111111111111111111111';

export function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    'https://api.mainnet-beta.solana.com'
  );
}

/**
 * Production-safe wrapper around `solanaRpcUrl()`. Throws if running in
 * production without a dedicated RPC configured.
 *
 * Use this in any code path that triggers a real RPC call. The plain
 * `solanaRpcUrl()` is preserved for dev/test code that wants the
 * fallback chain unconditionally.
 *
 * The public mainnet-beta default is rate-limited and unsafe for burn
 * verification under load (plan §10.2, A6 RPC compromise / outage).
 * Failing closed at startup is preferable to a quiet degradation that
 * surfaces as `rpc_error` to paying users.
 */
export function getRpc(): string {
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.SOLANA_RPC_URL &&
    !process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  ) {
    throw new Error(
      '[vizzor-solana] refusing to call RPC: SOLANA_RPC_URL is unset in production. ' +
        'The public mainnet-beta default is rate-limited and unsafe for burn verification ' +
        'under load. Configure a dedicated provider and set SOLANA_RPC_URL. ' +
        'See docs/ops/secrets.md.',
    );
  }
  return solanaRpcUrl();
}

export function vizzorMint(): string | null {
  return process.env.NEXT_PUBLIC_VIZZOR_MINT ?? null;
}

export function burnAmount(): number {
  const raw = process.env.NEXT_PUBLIC_VIZZOR_BURN_AMOUNT;
  if (!raw) return 1;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
