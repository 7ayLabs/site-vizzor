/**
 * Feature flags — single source of truth for runtime toggles.
 *
 * All flags are read from `process.env`. Public flags use the
 * `NEXT_PUBLIC_*` prefix so they're inlined into the client bundle at
 * build time.
 *
 * v0.2.0 ships Solana-native-only — TON / EVM-USDC / $VZR multi-chain
 * support was removed in favor of a single, well-tested rail.
 */

const DEFAULT_FREE_PREDICTIONS = 7;
const DEFAULT_PAYMENT_RATE_LOCK_SECONDS = 5 * 60;
const DEFAULT_FREE_TRIAL_DAYS = 7;
const DEFAULT_TRIAL_DAILY_CAP = 10;
const DEFAULT_PRO_DAILY_CAP = 1000;
const DEFAULT_PROMPT_BYTE_CAP = 2048;

/**
 * @deprecated v0.3.2 — the legacy "N predictions per wallet forever"
 * gate was replaced by a time-based 7-day Pro trial with a per-day
 * cap. Kept for one release in case any legacy caller still reads it;
 * remove in v0.3.3.
 */
export function freePredictions(): number {
  const raw = process.env.NEXT_PUBLIC_FREE_PREDICTIONS;
  if (!raw) return DEFAULT_FREE_PREDICTIONS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FREE_PREDICTIONS;
}

/**
 * Trial window length, in days. Each wallet gets full Pro-equivalent
 * access from `trial_started_at` for this many days. Defaults to 7 to
 * mirror the Telegram bot's `grantTrial()` window.
 */
export function freeTrialDays(): number {
  const raw = process.env.NEXT_PUBLIC_FREE_TRIAL_DAYS;
  if (!raw) return DEFAULT_FREE_TRIAL_DAYS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n <= 90 ? n : DEFAULT_FREE_TRIAL_DAYS;
}

/**
 * Maximum predictions a trial wallet can make per UTC day. The cost
 * ceiling: 7d × cap × ~$0.40 worst-case Sonnet ≈ $28 / wallet hard
 * limit before lockout. Defaults to 10 which is well above legitimate
 * exploration but caps a runaway script.
 */
export function trialDailyCap(): number {
  const raw = process.env.NEXT_PUBLIC_TRIAL_DAILY_CAP;
  if (!raw) return DEFAULT_TRIAL_DAILY_CAP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TRIAL_DAILY_CAP;
}

/**
 * Per-day cap for paid Pro subscribers. Elite tier is uncapped (∞).
 * Pro at 1000/day matches the engine's `aiChat.toolUse` soft cap so
 * the site and engine surfaces stay aligned.
 */
export function proDailyCap(): number {
  const raw = process.env.NEXT_PUBLIC_PRO_DAILY_CAP;
  if (!raw) return DEFAULT_PRO_DAILY_CAP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PRO_DAILY_CAP;
}

/**
 * Maximum bytes accepted in the latest user message before /predict
 * forwards to the engine. Refuses runaway prompts ("novel as a query")
 * cheaply at the proxy. ~500 words of typical English text fits in
 * 2048 bytes; legitimate prompts are well under that.
 */
export function promptByteCap(): number {
  const raw = process.env.NEXT_PUBLIC_PROMPT_BYTE_CAP;
  if (!raw) return DEFAULT_PROMPT_BYTE_CAP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PROMPT_BYTE_CAP;
}

/**
 * Operator kill-switch. When set to `free`, trial users are downgraded
 * to the `free` tier path immediately (no LLM calls) — use to staunch
 * a cost spike. Default: `pro` (trial wallets see Pro-equivalent
 * features).
 */
export function trialTierOverride(): 'pro' | 'free' {
  return process.env.NEXT_PUBLIC_TRIAL_TIER_OVERRIDE === 'free' ? 'free' : 'pro';
}

/**
 * Gates the /pay/* checkout shell and the Solana watcher daemon.
 * When false (default), the route renders a "payment infrastructure
 * pending" panel and the watcher refuses to boot. Flip to true once
 * the treasury address is set and the watcher has been validated.
 */
export function acceptSolanaPayments(): boolean {
  return process.env.NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS === 'true';
}

/**
 * Lifetime of a payment session before the locked USD-to-SOL rate
 * expires. Defaults to 5 minutes.
 */
export function paymentRateLockSeconds(): number {
  const raw = process.env.NEXT_PUBLIC_PAYMENT_RATE_LOCK_SECONDS;
  if (!raw) return DEFAULT_PAYMENT_RATE_LOCK_SECONDS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 60 && n <= 3600
    ? n
    : DEFAULT_PAYMENT_RATE_LOCK_SECONDS;
}
