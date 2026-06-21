# Security Policy

We take the security of Vizzor and its users seriously. This document
covers responsible-disclosure expectations, in-scope and out-of-scope
surfaces, and how we respond to reports.

## Reporting a Vulnerability

**Preferred channel:** [GitHub Security Advisories](https://github.com/7ayLabs/site-vizzor/security/advisories/new)
— private, encrypted, fully auditable.

**Backup channel:** `security@vizzor.ai`. Encrypt with the project PGP
key (fingerprint published on the disclosure page). We aim to ack
receipts within 48 hours.

Please **do not** open a public issue, pull request, or social-media
post for a vulnerability until we've had a chance to coordinate a fix.

When you report, include:
- A clear description of the issue and impact.
- Reproduction steps (curl commands, scripts, screen recordings).
- Affected version / commit SHA / endpoint.
- Your name and a contact channel — credit in the advisory is optional
  but appreciated.

## Disclosure Window

We follow a **90-day coordinated disclosure** model:
- Day 0: report received → acknowledgement within 48h.
- Day 0–14: triage + severity assessment.
- Day 14–60: fix developed + tested.
- Day 60–90: deploy + monitor + publish a CVE-style advisory.

We may extend the window for issues that require coordinated patches
across the Vizzor platform (`api.vizzor.ai`, the Telegram bot, the CLI),
or shorten it if active exploitation is detected.

## Scope

**In scope** (this repository):
- The Next.js site at `vizzor.ai`.
- The payment session, watcher, and grant routes (`/api/payment/*`,
  `/api/grants/*`, `/api/auth/siws/*`, `/api/subscriptions/lookup`,
  `/api/wallet-links*`, `/api/account/delete`).
- Cryptographic primitives in `lib/payment/siws.ts`, the auth-session
  hashing in `lib/payment/auth-session.ts`, the bot shared-secret
  comparator in `lib/payment/bot-auth.ts`.
- The Solana watcher in `lib/payment/watcher.ts` and the replay cache
  in `lib/payment/replay-cache.ts`.
- The HTTP-layer security middleware (`middleware.ts`, headers + CSP).
- The rate-limit token bucket (`lib/payment/rate-limit.ts`).
- The CI/CD supply-chain posture (`.github/workflows/*`, `Dockerfile`,
  `.gitleaks.toml`, `.github/dependabot.yml`, `pnpm.overrides`).

**Out of scope:**
- The upstream prediction engine at `api.vizzor.ai` — has its own
  threat model and reporting path.
- The Telegram bot binary — separate repo, separate disclosure.
- Public RPC providers (Solana mainnet, CoinGecko) — report to them.
- Issues that require a malicious wallet adapter the user has installed
  themselves; we defend against the Brave Wallet hijack and Wallet
  Standard mismatches but cannot make a compromised browser safe.
- Denial of service via excessive legitimate traffic — addressed by
  the per-route rate limiter, but volumetric DoS is the operator's
  problem.

## What We Care About Most

We assign the highest severity to:
1. Payment forgery — claiming a subscription without paying.
2. Replay attacks against the SIWS or grant flows.
3. Cross-account access — reading or modifying another wallet's data.
4. Bot-secret leak via the site's logs, error pages, or response bodies.
5. SQL injection or arbitrary write to the SQLite database.
6. PII leak — wallet addresses or Telegram IDs in unauthenticated
   responses, logs, or third-party hosts.

We will not pursue:
- Self-XSS — the user pastes a payload into their own DevTools.
- Missing security headers we already document as Report-Only (e.g.,
  CSP during the rollout window — see `middleware.ts` §A1).
- Best-practice findings that don't yield a working exploit on the
  current commit.

## Hall of Fame

This section lists prior disclosures and the researchers who reported
them. Currently empty — we'd love to credit you.

## Standards We Track

- OWASP ASVS 4.0 (Application Security Verification Standard).
- OWASP Top 10 (2021).
- NIST SP 800-63B (digital identity / session management).
- CAIP-122 (chain-agnostic Sign-In With X).
- EIP-712 (typed structured data, when the EVM link variant ships).

The internal threat model and control mapping live in
[`docs/security/threat-model.md`](docs/security/threat-model.md). The
end-user privacy policy is at [`/legal/privacy`](https://vizzor.ai/legal/privacy)
and its source at [`docs/legal/privacy.md`](docs/legal/privacy.md).
