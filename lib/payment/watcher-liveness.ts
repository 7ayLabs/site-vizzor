/**
 * Watcher liveness tracker.
 *
 * Each on-chain watcher (Solana, TON, Base, Arbitrum) reports a
 * heartbeat via `markTick(chain)` on every successful poll cycle.
 * `/api/health` reads `snapshotLiveness()` and flags any watcher
 * whose last tick is older than `STALE_THRESHOLD_MS` as `degraded`.
 *
 * The state is held on `globalThis` under a `Symbol.for` key so HMR
 * and Next route cold-starts inside the same Node process share it.
 *
 * Per plan §10.10: a stuck watcher is observable. The health endpoint
 * surfaces this without 500-ing so the deploy smoke-test can still
 * pass while the operator triages the offending RPC.
 */

const KEY = Symbol.for('vizzor.payment.watcher-liveness');
const STALE_THRESHOLD_MS = 30_000;

export type WatcherChain = 'solana' | 'ton' | 'base' | 'arbitrum';

interface LivenessState {
  ticks: Map<WatcherChain, number>;
  starts: Map<WatcherChain, number>;
}

interface GlobalWithLiveness {
  [KEY]?: LivenessState;
}
const g = globalThis as unknown as GlobalWithLiveness;

function getState(): LivenessState {
  if (!g[KEY]) {
    g[KEY] = { ticks: new Map(), starts: new Map() };
  }
  return g[KEY];
}

/** Called by `ensure*WatcherStarted` so the health endpoint knows the
 *  watcher was supposed to be running on this node. */
export function markStarted(chain: WatcherChain): void {
  const state = getState();
  if (!state.starts.has(chain)) {
    state.starts.set(chain, Date.now());
  }
}

/** Called from every successful poll-tick. Cheap (Map.set). */
export function markTick(chain: WatcherChain): void {
  const state = getState();
  state.ticks.set(chain, Date.now());
}

export interface WatcherSnapshot {
  chain: WatcherChain;
  started: boolean;
  lastTickAt: number | null;
  lastTickAgoMs: number | null;
  stale: boolean;
}

export function snapshotLiveness(): WatcherSnapshot[] {
  const state = getState();
  const now = Date.now();
  const chains: WatcherChain[] = ['solana', 'ton', 'base', 'arbitrum'];
  return chains.map((chain) => {
    const started = state.starts.has(chain);
    const lastTickAt = state.ticks.get(chain) ?? null;
    const lastTickAgoMs = lastTickAt === null ? null : now - lastTickAt;
    return {
      chain,
      started,
      lastTickAt,
      lastTickAgoMs,
      // A watcher is stale only if it was started AND we haven't seen
      // a heartbeat within the threshold. Not-started watchers are
      // intentionally idle (feature flag off), not unhealthy.
      stale:
        started &&
        (lastTickAt === null || lastTickAgoMs! > STALE_THRESHOLD_MS),
    };
  });
}
