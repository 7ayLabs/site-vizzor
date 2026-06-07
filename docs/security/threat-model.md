# Site Vizzor — Threat Model (v0.2.x security pass)

**Scope:** the Next.js site at `vizzor.ai` — payment routes, auth
flow, watcher, bot-binding routes, deployment surface. The upstream
prediction engine at `api.vizzor.ai`, the Telegram bot binary, and
the CLI carry their own threat models in adjacent repos.

**Posture:** zero-trust between the site and every external surface
(wallets, RPCs, Telegram bot, payment chains, CDN), fail-closed
defaults on every authentication and rate-limit gate, hashed
identifiers on every PII storage path.

---

## Adversaries

| ID | Adversary | Capability ceiling |
|---|---|---|
| **A1** | External attacker | Unauthenticated HTTP requests, RPC observability, on-chain inspection. |
| **A2** | Authenticated wallet-as-attacker | Holds a valid SIWS session + wallet keys; tries to escalate to other accounts. |
| **A3** | Compromised Telegram bot host | Has the bot shared secret; tries to enumerate or forge subscriptions. |
| **A4** | Supply chain | Malicious npm package, base-image swap, or pinned Docker tag mutation. |
| **A5** | Insider with VPS access | Operator with shell on the host; tries to read durable PII from disk. |
| **A6** | RPC provider compromise | Solana RPC returns falsified transactions or omits real ones. |
| **A7** | MEV / mempool observer | Public mempool surveillance; tries to race a memo collision. |
| **A8** | Smart-contract counterparty | The USDC contract (future) or an upgrade introduces transfer-tax or blacklist behavior. |

---

## Controls matrix (v0.2.x security slice)

| Control | Defends against | Source |
|---|---|---|
| HSTS + X-Frame-Options + X-Content-Type-Options + Referrer-Policy + Permissions-Policy + CSP (Report-Only) + COOP + CORP | A1, A2 | `middleware.ts` §A1 |
| Per-IP token-bucket rate-limit on auth, payment, bot, retention, account-delete routes | A1, A3 | `lib/payment/rate-limit.ts` |
| `Origin` header defense-in-depth on mutating routes | A1, A2 | `lib/payment/origin-check.ts` |
| SIWS action scope (Login vs Link Wallet) | A1, A2 | `lib/payment/siws.ts` (committed `464b268`) |
| Nonce single-use + 5-minute TTL + HttpOnly + SameSite=Strict + Secure-in-prod | A1, A2 | `app/api/auth/siws/nonce/route.ts` |
| Auth session token hashed at rest (SHA-256) | A1, A5 | `lib/payment/auth-session.ts` `hashAuthToken()` |
| Constant-time bot shared-secret compare + fail-closed prod + rotation window | A3 | `lib/payment/bot-auth.ts` (committed `464b268`) |
| Audit log of bot-route PII reads (hashed subject, hashed IP, hashed UA) | A3, A5 | `lib/payment/audit.ts` |
| `/api/account/delete` (GDPR right to erasure) | A2 (data minimization) | `app/api/account/delete/route.ts` |
| Daily retention sweep (30/90/365-day windows) | A5 (PII surface bound) | `lib/payment/retention.ts` |
| Persistent signature replay cache | A1, A6, A7 | `lib/payment/replay-cache.ts` |
| Finalized commitment for ≥$100 USD sessions | A6 (reorg-replay) | `lib/payment/watcher.ts` `commitmentForAmount()` |
| Watcher payer address redacted in logs (first-4 / last-4) | A5 (log aggregator PII) | `lib/payment/log-redact.ts` |
| Solana mainnet requires private RPC in prod (fail-closed) | A6 (rate-limit eviction by public RPC) | `lib/payment/watcher.ts` `ensureWatcherStarted()` |
| Container runs as `nextjs:1001` non-root | A4, A5 | `Dockerfile:51` |
| `node:20-alpine` pinned to digest | A4 | `Dockerfile:6,42` |
| `pnpm install --frozen-lockfile` in CI | A4 | `.github/workflows/ci.yml:40` |
| `pnpm audit --audit-level high --prod` blocking in CI | A4 | `.github/workflows/ci.yml` |
| gitleaks secret scan on PR diff | A1, A5 | `.github/workflows/ci.yml` + `.gitleaks.toml` |
| Dependabot weekly for npm + github-actions + docker | A4 | `.github/dependabot.yml` |
| `pnpm.overrides` for protobufjs CVE | A4 | `package.json` |
| `/api/health` validates SQLite + watcher subsystems; deploy smoke test asserts both | A5 (silent failure) | `app/api/health/route.ts`, `.github/workflows/deploy.yml` |

---

## Out-of-slice work (tracked follow-ups)

These are documented gaps the v0.2.x security pass did *not* close.
Each ships in a later slice; the threat model entry stays here so we
don't lose track.

- **G1. ESLint CLI migration + lint hard-gate.** `next lint` is
  interactive and deprecated in Next 15. We need to migrate to the
  ESLint CLI (`pnpm dlx @next/codemod@canary next-lint-to-eslint-cli`)
  before the CI `pnpm lint` step can be flipped from soft to
  blocking. Tracked in `.github/workflows/ci.yml` comment.
- **G2. Sentry wiring with `beforeSend` redaction.** The env var
  `SENTRY_DSN` is documented in `.env.example`; the `@sentry/nextjs`
  package and the three `sentry.*.config.ts` files are not yet added.
  The redaction shape lives in this doc; install pulls down ~150 KB
  client bundle so it's intentionally deferred.
- **G3. Per-challenge nonce cookies (UUID-keyed).** Multi-tab safety
  improvement — when a user clicks Connect in two tabs, the second
  tab's nonce currently overwrites the first. Not a security gap;
  UX-tier robustness.
- **G4. SQLCipher full-database encryption.** Chose to ship hashed
  auth tokens + disk encryption at the OS layer for v0.2.x. If a
  threat model evolves toward "host disk leaked while powered on"
  (LUKS doesn't help), we revisit.
- **G5. EIP-712 typed-data link variant** for the future EVM-side
  wallet linking flow. Not in v0.2.x because EVM payments are
  deferred (`v0.2.x` is Solana-only).
- **G6. ATA self-test for SPL token treasury.** v0.2.x watcher only
  handles native SOL transfers to a system-account treasury. When
  SPL token payments ship, extend the existing pattern from
  `crypto-security` (`VIZZOR_EXPECTED_INCINERATOR_ATA`) to
  `VIZZOR_EXPECTED_TREASURY_ATA`.

---

## Compliance posture (recap)

- **Not a money transmitter.** Vizzor receives payment for SaaS
  access; we don't transmit funds on behalf of third parties.
- **AML / KYC.** Below relevant thresholds for v0.2.x. Treasury
  addresses are pre-screened against OFAC SDN before deploy
  (operator runbook).
- **GDPR.** Telegram user IDs are PII. We document storage, retention
  windows (30 / 90 / 365 days), and a deletion path
  (`/api/account/delete`). Privacy policy at `/legal/privacy`.
- **Logging.** Wallet addresses are public on-chain but treated as
  pseudonymous PII; truncated to first-4 / last-4 before any log
  statement. Telegram user IDs are hashed before persistence into
  the audit log.

## Reference

- [OWASP ASVS 4.0](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [CAIP-122 SIWS](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-122.md)
- Internal: [`SECURITY.md`](../../SECURITY.md), [`docs/legal/privacy.md`](../legal/privacy.md), [`docs/ops/runbook-security-incident.md`](../ops/runbook-security-incident.md)
