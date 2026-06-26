/**
 * TON RPC config + TonClient singleton.
 *
 * Mirrors `lib/solana.ts` exactly: cluster-specific env var → generic
 * env var → public fallback. The watcher daemon (`lib/payment/
 * watcher-ton.ts`) uses `getTonClient()` so we don't reconnect every
 * 6-second tick.
 *
 * RPC choice: toncenter is the standard public TON HTTP API. The free
 * tier is rate-limited; configure a paid API key for production
 * (`VIZZOR_TON_RPC_URL_MAINNET` includes it as a query param). Testnet
 * has a separate base URL — never mix.
 */

import { TonClient } from '@ton/ton';
import { paymentNetwork } from './payment/network';

const MAINNET_FALLBACK = 'https://toncenter.com/api/v2/jsonRPC';
const TESTNET_FALLBACK = 'https://testnet.toncenter.com/api/v2/jsonRPC';

export function tonRpcUrl(): string {
  const network = paymentNetwork();
  if (network === 'mainnet') {
    return (
      process.env.VIZZOR_TON_RPC_URL_MAINNET ??
      process.env.VIZZOR_TON_RPC_URL ??
      MAINNET_FALLBACK
    );
  }
  // TON has no devnet; testnet covers both staging and dev. The
  // resolver returns the same testnet URL for `network === 'testnet'`
  // and `network === 'devnet'`.
  return (
    process.env.VIZZOR_TON_RPC_URL_TESTNET ??
    process.env.VIZZOR_TON_RPC_URL ??
    TESTNET_FALLBACK
  );
}

const KEY = Symbol.for('vizzor.ton.client');
interface GlobalWithClient {
  [KEY]?: { url: string; client: TonClient };
}
const g = globalThis as unknown as GlobalWithClient;

/**
 * Get the shared TonClient singleton. Re-creates the client if the
 * resolved RPC URL changed (e.g. an env update between requests in
 * dev), otherwise returns the cached instance.
 */
export function getTonClient(): TonClient {
  const url = tonRpcUrl();
  const hit = g[KEY];
  if (hit && hit.url === url) return hit.client;
  const client = new TonClient({ endpoint: url });
  g[KEY] = { url, client };
  return client;
}
