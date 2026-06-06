/**
 * EVM USDC payment watcher — Base + Arbitrum.
 *
 * Polls each enabled L2 every 10 seconds for new USDC `Transfer` events
 * landing at the per-chain treasury address, matches each transfer to
 * a pending `payment_sessions` row by **exact raw amount** (the
 * amount-as-uniqueness collision defense from plan §10.2), and calls
 * the shared `finalizeSession()` once confirmations clear.
 *
 * Per-chain security controls (plan §10.2 EVM USDC-specific):
 *
 *   - **Canonical USDC contract pinning.** The Circle-issued USDC
 *     address is hard-coded per chain. Transfer events from any other
 *     ERC-20 are dropped. Defeats A8 (someone deploying a fake "USDC"
 *     contract and tricking the watcher).
 *
 *   - **Whitelist log filter.** `getLogs` queries with `address` set
 *     to the canonical USDC contract AND topic[2] (indexed `to`) set
 *     to the treasury — no other shape is fetched, let alone parsed.
 *
 *   - **MIN_CONFIRMATIONS = 5.** On Base / Arbitrum that's ≈10s, well
 *     past the practical reorg horizon. Confirmations are computed as
 *     `currentBlock - logBlock` per chain.
 *
 *   - **Amount-as-uniqueness.** Two concurrent pending sessions on
 *     the same tier × cadence × chain × token tuple would otherwise
 *     share the same amount and be impossible to demux at a shared
 *     treasury. Each USDC session locks a unique 4-cent salt derived
 *     from its `session_id`; the watcher matches by raw uint256 to a
 *     single pending row.
 *
 *   - **No EIP-2612 `permit`.** v0.2.0 only accepts the canonical
 *     `transfer(to, amount)` calldata. Permit signatures expand the
 *     attack surface (relayer race) and aren't needed for our flow.
 *
 *   - **RPC redundancy.** Per-chain `RPC_URL` and `RPC_URL_FALLBACK`
 *     env vars. After three consecutive tick failures the watcher
 *     rotates to the fallback URL.
 *
 * Boot semantics: importing `ensureEvmWatchersStarted()` from a server
 * route is safe — each chain's `started` flag is stashed on
 * globalThis under a symbol so HMR doesn't spin up duplicates.
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
} from 'viem';
import { arbitrum, base } from 'viem/chains';
import {
  acceptUsdcArbPayments,
  acceptUsdcBasePayments,
} from '@/lib/feature-flags';
import { listPendingSessions, type SessionRow } from './db';
import { finalizeSession } from './session';
import { evmTreasury } from './treasury';

/** Circle-issued USDC contract addresses. Hard-coded — no env override.
 *  Anything pretending to be USDC at a different address is rejected. */
const USDC_CONTRACTS: Record<EvmChain, Address> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
};

const USDC_DECIMALS = 6;
const MIN_CONFIRMATIONS = 5n;
const POLL_INTERVAL_MS = 10_000;
/** ERC-20 Transfer event signature. */
const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

type EvmChain = 'base' | 'arbitrum';

interface WatcherState {
  chain: EvmChain;
  started: boolean;
  lastBlock: bigint | null;
  consecutiveFailures: number;
}

const KEY = Symbol.for('vizzor.payment.evm-watcher');
interface GlobalWithEvmWatchers {
  [KEY]?: Map<EvmChain, WatcherState>;
}
const g = globalThis as unknown as GlobalWithEvmWatchers;

function getStateMap(): Map<EvmChain, WatcherState> {
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

export function ensureEvmWatchersStarted(): void {
  const states = getStateMap();
  if (acceptUsdcBasePayments()) startChain('base', states);
  if (acceptUsdcArbPayments()) startChain('arbitrum', states);
}

function startChain(chain: EvmChain, states: Map<EvmChain, WatcherState>) {
  let state = states.get(chain);
  if (!state) {
    state = {
      chain,
      started: false,
      lastBlock: null,
      consecutiveFailures: 0,
    };
    states.set(chain, state);
  }
  if (state.started) return;
  state.started = true;
  void tick(state);
}

function rpcUrl(chain: EvmChain, useFallback: boolean): string | undefined {
  if (useFallback) {
    if (chain === 'base') {
      return (
        process.env.VIZZOR_EVM_RPC_BASE_FALLBACK ??
        process.env.VIZZOR_EVM_RPC_BASE
      );
    }
    return (
      process.env.VIZZOR_EVM_RPC_ARB_FALLBACK ??
      process.env.VIZZOR_EVM_RPC_ARB
    );
  }
  if (chain === 'base') return process.env.VIZZOR_EVM_RPC_BASE;
  return process.env.VIZZOR_EVM_RPC_ARB;
}

function makeClient(chain: EvmChain, useFallback: boolean) {
  const url = rpcUrl(chain, useFallback);
  return createPublicClient({
    chain: chain === 'base' ? base : arbitrum,
    transport: http(url),
  });
}

async function tick(state: WatcherState): Promise<void> {
  try {
    await pollOnce(state);
    state.consecutiveFailures = 0;
  } catch (e) {
    state.consecutiveFailures += 1;
    // eslint-disable-next-line no-console
    console.error(
      `[vizzor-evm-watcher:${state.chain}] tick failed (#${state.consecutiveFailures}):`,
      e,
    );
  } finally {
    setTimeout(() => tick(state), POLL_INTERVAL_MS);
  }
}

async function pollOnce(state: WatcherState): Promise<void> {
  const pending = listPendingSessions(Date.now()).filter(
    (s) => s.chain === state.chain && s.token === 'usdc',
  );
  if (pending.length === 0) return;

  let treasury: Address;
  try {
    treasury = evmTreasury(state.chain) as Address;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      `[vizzor-evm-watcher:${state.chain}] treasury missing:`,
      (e as Error).message,
    );
    return;
  }

  const useFallback = state.consecutiveFailures >= 3;
  const client = makeClient(state.chain, useFallback);
  const currentBlock = await client.getBlockNumber();

  // First tick: anchor at currentBlock - 50 so we cover a brief
  // window if the watcher started shortly after a session was paid.
  // Subsequent ticks pick up from lastBlock + 1.
  const fromBlock =
    state.lastBlock === null ? currentBlock - 50n : state.lastBlock + 1n;

  // Don't query past the confirmation horizon — confirmations beyond
  // currentBlock - MIN_CONFIRMATIONS aren't yet durable.
  const toBlock = currentBlock - MIN_CONFIRMATIONS;
  if (toBlock < fromBlock) {
    return; // nothing newly-confirmed since last tick
  }

  const logs = await client.getLogs({
    address: USDC_CONTRACTS[state.chain],
    event: TRANSFER_EVENT,
    args: { to: treasury },
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    const args = log.args;
    if (!args || typeof args.value !== 'bigint' || !args.from) continue;
    if (args.to?.toLowerCase() !== treasury.toLowerCase()) continue;

    // Amount-as-uniqueness match: pick the pending session whose
    // stored amount (in USDC human units) equals the raw transfer
    // value divided by 10^6 EXACTLY. Each session's stored amount
    // carries the per-session salt at v0.2.0 createSession time, so
    // two concurrent same-tier sessions on the same chain can't
    // both match the same Transfer event.
    const session = pending.find(
      (s) => humanToRaw(s.amount, USDC_DECIMALS) === args.value,
    );
    if (!session) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-evm-watcher:${state.chain}] unmatched transfer value ${args.value.toString()} from ${args.from}`,
      );
      continue;
    }

    const result = finalizeSession(
      session,
      log.transactionHash ?? '',
      args.from,
    );
    if (result.confirmed) {
      // eslint-disable-next-line no-console
      console.info(
        `[vizzor-evm-watcher:${state.chain}] confirmed ${session.session_id} · ${session.tier}/${session.cadence} · payer=${args.from}${result.walletLinkedTo ? ` · tg=${result.walletLinkedTo}` : ''}`,
      );
    }
  }

  state.lastBlock = toBlock;
}

/**
 * Convert a human-units USDC amount (number) to raw uint256. We
 * round to USDC_DECIMALS via integer math to avoid IEEE-754 drift
 * on the boundary (e.g., 9.4923 → 9492300n exactly).
 */
function humanToRaw(human: number, decimals: number): bigint {
  const scale = 10 ** decimals;
  return BigInt(Math.round(human * scale));
}

// Re-export for test harness symmetry with the other watchers.
export type { SessionRow };
