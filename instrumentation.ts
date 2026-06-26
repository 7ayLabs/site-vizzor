/**
 * Next.js server-runtime instrumentation hook.
 *
 * Runs ONCE per Node server process at boot — before the first request
 * is served. We use it for security-critical initialization that needs
 * to happen even on cold start: the OFAC SDN sanctions feed refresh
 * (gated to a 24 h interval) and the in-memory sanctions seed.
 *
 * Why here, not in a route module:
 *   - Route modules load lazily on first request, leaving a window
 *     between container start and the first payment where the
 *     sanctions table could be stale.
 *   - The watcher boots from the payment-session route on its first
 *     request, which is fine for the watcher itself but not for the
 *     sanctions table — the watcher SCREENS payers against that table
 *     and we want the freshest list available before the first screen
 *     ever runs.
 *
 * Runtime gate:
 *   - `NEXT_RUNTIME === 'nodejs'` — skip on edge runtime (the middleware
 *     and edge functions don't need sanctions / DB access).
 *
 * Failure mode:
 *   - All work is wrapped in try/catch — a transient OFAC mirror outage
 *     must NOT prevent the server from booting. Worst case is we
 *     continue with the existing table and retry on the next cold start.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // OFAC refresh — gated to 24 h via the sentinel file. Fire-and-forget
  // so a slow OFAC mirror doesn't delay the readiness probe; the
  // sanctions table already has the seed list as a floor.
  try {
    const { refreshOfacFeedIfStale } = await import(
      './scripts/refresh-ofac'
    );
    void refreshOfacFeedIfStale().then((r) => {
      if (r.ran && r.summary) {
        // eslint-disable-next-line no-console
        console.info(
          `[ofac] refresh ok — inserted ${r.summary.inserted} ` +
            `addresses (errors: ${r.summary.errors.length})`,
        );
      } else if (r.reason) {
        // eslint-disable-next-line no-console
        console.info(`[ofac] refresh skipped — ${r.reason}`);
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ofac] refresh module unavailable:',
      (e as Error)?.message ?? e,
    );
  }

  // Sanctions seed — synchronous, cheap. Ensures the table has at
  // least the curated minimum before the first watcher tick.
  try {
    const { ensureSeeded } = await import('./lib/payment/sanctions');
    ensureSeeded();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[sanctions] seed init failed:',
      (e as Error)?.message ?? e,
    );
  }
}
