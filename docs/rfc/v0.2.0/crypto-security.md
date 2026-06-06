# RFC: v0.2.0 Crypto Security — Threat Model and Audit Findings

Status: Accepted for v0.2.0
Cycle: v0.2.0
Owner: feature/v0.2.0/crypto-security
Companions: `docs/rfc/v0.2.0/architecture.md`, `docs/rfc/v0.2.0/wallet-telegram-binding.md`

---

## 1. Purpose and scope

This RFC discharges the deferred audit obligation that the binding RFC §8 delegated to C4. It enumerates the security-sensitive assets of the v0.2.0 surface, the adversaries that touch them, the gaps observed in the code that lives at `release/v0.2.0` HEAD plus the C1 and C2 work it consumes, and the controls that this PR ships or files into the backlog. It is not a penetration-test report; it is the threat model that scopes that work and the audit findings that should drive the next iteration of patches.

The surface in scope:

- `lib/payment/siws.ts` — wallet-based browser auth (SIWS) for the site.
- `lib/solana.ts` (client-safe constants + env helpers) and `lib/solana-server.ts` (`verifyBurnTx` + SPL transfer parser + ATA self-test) — the burn-to-predict gate.
- `lib/payment/watcher.ts` — Solana watcher that confirms session payments and mints subscriptions.
- `lib/payment/treasury.ts` — treasury address indirection (HD derivation comes from C1).
- `lib/payment/db.ts` — site SQLite store for sessions, subscriptions, grants, auth sessions, wallet links.
- `app/api/auth/siws/{nonce,verify}/route.ts` — SIWS HTTP surface.
- `app/api/predict/route.ts` — burn-tx header validation gate.
- The forthcoming `app/api/grants/[code]/redeem/route.ts`, `app/api/subscriptions/lookup/route.ts`, `app/api/wallet-links/{,challenge}/route.ts` from C2.
- The shared-secret transport (`x-vizzor-bot-token`) between the bot and the site.

Out of scope:

- Engine-side authorization, except where the site's contract with the engine creates a security obligation (none does in v0.2.0; the engine receives no payment state from the site).
- Solana program / smart-contract audits — the site does not deploy any program.
- Wallet-adapter UI library audit (covered by C3's UX review; we audit only the cryptography surface).

## 2. Asset inventory

| Asset                                            | Storage                                                                                                                       | Confidentiality | Integrity | Availability | Notes |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------- | --------- | ------------ | ----- |
| Treasury keypair (HD master mnemonic, future C1) | Env var `VIZZOR_TREASURY_MNEMONIC` on the site host; managed secret store in C6.                                              | Critical        | Critical  | High         | Today the site holds only the public address (`VIZZOR_SOLANA_TREASURY`, `VIZZOR_TON_TREASURY`). HD mnemonic is C1 work; this RFC §6 documents the custody requirements C6 must satisfy. |
| SIWS server-side entropy                         | `randomBytes(16)` for nonces, `randomBytes(32)` for auth tokens, both produced by `node:crypto` per request.                  | High            | Critical  | High         | No persistent server-side secret beyond Node's CSPRNG. Tokens land in SQLite (`auth_sessions.token`) as primary keys. |
| Bot ↔ site shared secret                         | Env var `VIZZOR_BOT_SHARED_SECRET` on the site host; mirrored on the bot host. C6 migrates to a managed secret store.        | Critical        | Critical  | High         | Single static value today. RFC §7 below specifies rotation. |
| User wallet signatures (SIWS, link)              | Transient. Verified, then discarded; only the auth-session token is persisted.                                                | Public          | Critical  | n/a          | The signature itself is public-key cryptography output. Integrity matters because it grants browser session. |
| Grant codes (`g_<base64url-12>`)                 | `grants.code` in SQLite, 24h TTL, single use.                                                                                 | High            | Critical  | High         | Acts as a bearer credential between site and bot during the deep-link handshake. |
| Auth-session tokens                              | `auth_sessions.token` in SQLite, 24h TTL, cookie-bound (`vizzor.auth`).                                                       | Critical        | Critical  | High         | A leaked token equals a session takeover for the bound wallet until expiry. |
| Replay cache (burn signatures)                   | In-memory `Map<string, number>` in `lib/solana.ts`, capacity 4096, evicted FIFO. v0.2.0: moved to SQLite by this PR.          | Low             | Critical  | High         | A wiped cache during process restart re-opens a 5-minute replay window per signature. |
| Site SQLite database                             | `${VIZZOR_SITE_DB}` on local disk (default `.vizzor/site.db`).                                                                | High            | Critical  | Critical     | Contains all subscription state, grants, auth tokens, wallet links. C6 owns the persistent volume work. |
| RPC URLs (Solana, TON)                           | Env vars; default to public endpoints today.                                                                                  | Low             | High      | Critical     | An attacker who controls the configured RPC can lie about transaction state; treated as a control-plane secret. |

## 3. Adversary model

Each adversary is named, their capability ceiling is stated, and the assets they can touch are mapped. The (asset × adversary) matrix in §4 reuses these names.

### A1 — External attacker, no auth

A user on the open internet with no site credentials. Can call any public route, can submit any wallet address, can broadcast any transaction on Solana / TON. Cannot read site DB, cannot read server logs, cannot read env vars.

### A2 — Authenticated user-as-attacker

Holds a valid SIWS session for at least one wallet, and a valid grant code from at least one confirmed purchase. Wants to escalate that into a second subscription, replay a payment for a different tier, or redeem a grant for a Telegram user other than themselves.

### A3 — Malicious bot operator (compromise of bot host or shared secret)

The bot is operated by us, but the shared secret transit is a compromise vector: a leaked secret, a stolen bot deployment, or an insider on the bot side. Such an adversary can call every `x-vizzor-bot-token`-gated route as if they were the bot.

### A4 — Supply-chain attacker

Compromises a transitive dependency we install via pnpm. The relevant attack surface is the wallet-adapter graph (Phantom, Solflare, walletconnect, plus the transitive Trezor/Torus paths that the barrel re-export pulls in), the signature libraries (`tweetnacl`, `bs58`, `@solana/web3.js`), and the SQLite binding (`better-sqlite3`).

### A5 — Insider with VPS access

A platform engineer or operator with shell on the site host. Can read env vars, the SQLite file, and process memory. Limits: cannot mint Telegram identities, cannot sign on behalf of users (no user private keys exist on the host).

## 4. Asset × adversary matrix

For each pair, the relevant attack vectors, the controls today, and the gaps + recommended controls. Findings are severity-tagged (P0 / P1 / P2 / P3) and the inline numbers map to §10 backlog and §11 findings table.

### 4.1 Treasury keypair × A1

- **Vector**: forge a payment session to a non-treasury address; trick a user into paying.
- **Today**: `payment_sessions.dest_address` is server-set from `solanaTreasury()`/`tonTreasury()`. The client receives it from `GET /api/payment/session/[id]` but cannot influence it.
- **Gap**: none observed. The dest address is server-canonical.

### 4.2 Treasury keypair × A4 (supply chain)

- **Vector**: a compromised `@solana/spl-token` or `@solana/web3.js` derives an unexpected ATA, so the watcher confirms transfers that did not actually land in the incinerator or treasury ATA.
- **Today**: ATA derivation in `lib/solana.ts` is implemented locally with hard-coded program IDs (`TOKEN_PROGRAM_ID`, `ATA_PROGRAM_ID`) rather than imported from `@solana/spl-token`. This is a defensive choice that reduces blast radius. The watcher's owner check in `lib/payment/watcher.ts:181-211` does NOT call `getAssociatedTokenAddress`; instead it cross-references via post-token-balance owner == `treasuryOwner`, which is robust to a single compromised dependency.
- **Patch in this PR**: §6.2 below. `verifyBurnTx` now runs a memoized startup assertion (`runAtaSelfTest`) that compares the derived incinerator ATA against `VIZZOR_EXPECTED_INCINERATOR_ATA` and fails closed with `ata_self_test_failed` on mismatch. When the env var is unset the self-test is a no-op (dev/staging). Backlog item B1 / B9 closed.

### 4.3 Treasury keypair × A5 (insider)

- **Vector**: shell access to the host reads the future `VIZZOR_TREASURY_MNEMONIC` and drains the treasury (C1 work).
- **Today**: no mnemonic exists. The site only knows the public address.
- **Gap**: P1 — C1 introduces a mnemonic; this RFC §6 specifies the custody requirements that C6 must satisfy to mitigate A5 within an acceptable risk envelope.

### 4.4 SIWS server-side entropy × A1, A2

- **Vector**: predict a nonce, replay a signature, forge a session.
- **Today**: nonces are 16 bytes from `node:crypto.randomBytes`, 128-bit entropy, hex-encoded. Auth tokens are 32 bytes from the same CSPRNG, base64url-encoded, 256-bit entropy. Nonces live 5 minutes in cookie + are bound to the SIWS message that the wallet signs.
- **Gap**: none on entropy. See §5 for the multi-tab and signature-scope issues.

### 4.5 Bot ↔ site shared secret × A1

- **Vector**: brute force the secret via repeated requests to `/api/grants/[code]/redeem` or `/api/subscriptions/lookup`.
- **Today (post-C2)**: every bot route returns `401 unauthorized` on mismatch. The secret is 32 random bytes base64url-encoded (RFC §7 of the binding RFC), 256-bit entropy, infeasible to brute force.
- **Gap**: P2 — no rate limit on the lookup route, so an attacker who has a candidate guess can probe at line speed. Recommendation: per-IP rate limit at 10/s on bot routes, fail-closed. Backlog item B2.
- **Gap**: P3 — the site does not log the failed-auth count for the bot routes. Without a metric, A3 detection is harder. Backlog item B3.

### 4.6 Bot ↔ site shared secret × A3

- **Vector**: a compromised bot host calls every site route as the bot, including `POST /api/grants/[code]/redeem` for arbitrary `telegram_user_id`.
- **Today (post-C2)**: the site has no concept of "which TG user is paired with which bot" — the shared secret is a single value; once leaked, the attacker can redeem any unredeemed grant code on behalf of any TG user.
- **Mitigation**: grants are single-use (the `UPDATE grants SET redeemed_by WHERE redeemed_by IS NULL` clause in `redeemGrant()` makes the redemption non-replayable). The attack window is limited to unredeemed grants in the 24-hour TTL.
- **Gap**: P1 — rotation is the answer. RFC §7 below codifies the rotation procedure. The contract is enforced by C6 (managed secret store) and validated by the bot operator's runbook.

### 4.7 User wallet signature × A2 (cross-route replay)

- **Vector**: a user signs the SIWS message intending to log in (`purpose=login`), but the same bytes are accepted by the link-wallet route (`purpose=link`), causing an unintended binding to a TG user the attacker controls. Or the reverse: a link-wallet signature is replayed as a login on a different browser.
- **Today (pre-this-PR)**: the canonical SIWS message in `lib/payment/siws.ts:47-66` reads "Sign in to vizzor.ai" with no action discriminator. If C2 ships the link variant by only swapping that line, an attacker who phishes the user with a link UI that quietly displays the login phrase produces a signature that BOTH routes will accept. The verify routes recompute the message from the route's expected action, but if both routes happen to recompute the same template (with a phishing trick), the signature is cross-valid.
- **Patch in this PR**: §5.2. The message now includes a mandatory `Action: Login` or `Action: Link Wallet` line. The verify routes assert the action they expect and refuse anything else. A login signature cannot be replayed against the link route, and vice versa.

### 4.8 User wallet signature × A1 (replay across tabs)

- **Vector**: a user opens two `/login` tabs in succession, each calling `POST /api/auth/siws/nonce`. The cookie is overwritten each time. The user signs the most recently shown SIWS message but verify sees a cookie carrying the LATER nonce, so the EARLIER tab's signed message is no longer verifiable (mismatch). The reverse fails closed. However: if the user signs in tab 1 and submits in tab 1, but the cookie has been overwritten by tab 2's nonce request, verify rejects with `nonce_mismatch`. This is a UX bug but also a defense in depth.
- **Gap**: P2 — the user-facing failure mode is opaque. A determined attacker could exploit the race to force the user to re-sign, which is a phishing pretext. Recommendation: scope the nonce cookie to a UUID per challenge, not a single fixed-name cookie. Backlog item B4.

### 4.9 Grant codes × A1, A2

- **Vector**: brute-force the 12-byte (96-bit) base64url space; intercept a redirect URL.
- **Today**: 96-bit entropy is sound. Grants are single-use (`UPDATE ... WHERE redeemed_by IS NULL`) and TTL-bounded (24h).
- **Gap**: P3 — the grant code is appended as a query/path component to `t.me/<bot>?start=g_<code>`, which surfaces in browser history, referrer, and Telegram link previews. The 24h TTL plus single-use semantics are the mitigation; nothing else is feasible without a separate proof-of-possession step that the v0.2.0 UX explicitly rejects. Backlog item B5: consider rendering the deep-link with a one-tap deep-link only on mobile (avoiding href-based history leakage).

### 4.10 Auth-session tokens × A1

- **Vector**: steal the cookie via XSS, MITM, or session fixation.
- **Today**: cookies are `HttpOnly`, `SameSite=Lax`. The verify route deletes the nonce cookie on success.
- **Patch in this PR**: both `vizzor.siws.nonce` and `vizzor.auth` now append `; Secure` when `process.env.NODE_ENV === 'production'`. Staging without TLS keeps the pre-patch behavior (no regression). The toggle lives in `app/api/auth/siws/{nonce,verify}/route.ts`. Backlog item B6 closed.

### 4.11 Replay cache × A1, A2

- **Vector**: a paying user replays the same burn signature against `/api/predict` after a process restart, since the in-memory cache is wiped.
- **Today**: 4096-entry LRU in process memory plus the on-chain 5-minute blockTime window. A restart within 5 minutes of a paid burn re-opens the replay window for that one signature for the remainder of the 5-minute window.
- **Patch in this PR**: §6 — the cache is moved to a `signature_replay_cache` SQLite table with the same 4096-entry cap and FIFO eviction by `seen_at`. Cross-restart durable; backwards compatible with old in-memory installations (a fresh table is empty and behaves identically to a fresh process).

### 4.12 SQLite database × A4

- **Vector**: a compromised `better-sqlite3` returns crafted results that cause UB in the watcher or verify path.
- **Today**: pinned to `12.10.0`. No advisories. `@types/better-sqlite3` is a type-only package.
- **Gap**: covered under §8 CVE sweep.

### 4.13 SQLite database × A5

- **Vector**: shell access reads `auth_sessions.token` and forges a session.
- **Today**: tokens are stored in plaintext as PRIMARY KEYs.
- **Gap**: P2 — A5 with shell access already wins. Token-hashing helps only against a stolen DB snapshot. Recommendation: store SHA-256 of the token, compare hashes at session lookup. Backlog item B7. The compatibility cost is real — existing sessions would be invalidated by a migration, so this is a v0.3.0 candidate.

### 4.14 RPC URLs × A1, A4

- **Vector**: a malicious RPC returns finalized=true on a transaction that does not actually exist on chain.
- **Today**: `solanaRpcUrl()` defaults to `https://api.mainnet-beta.solana.com` (Solana Labs public endpoint). C6 owns the migration to a dedicated provider.
- **Gap**: P1 — the public Solana RPC has been DDOS'd in the past and rate-limits aggressively. The watcher will fall behind under load. C6 ships the env var; this RFC §9 enforces fail-closed if the env var is unset in production.

## 5. SIWS audit findings

### 5.1 Multi-tab nonce-cookie binding

**Finding (P2, backlog B4).** The nonce cookie name is fixed (`vizzor.siws.nonce`) and scoped to `Path=/api/auth`. Two tabs request a nonce in sequence; the second overwrites the first. If the user signs in tab 1 and submits in tab 1, the verify path reads tab 2's cookie value, recomputes against tab 2's `nonce`, and rejects with `nonce_mismatch`. This is fail-closed: no signature for tab 1's nonce can be validated against tab 2's nonce, because the canonical message includes `Nonce: <nonce>`. The user is forced to retry. There is no signature acceptance under any concurrent-tab race.

**Why it is a finding anyway.** The fail-closed error message is opaque to the user (`nonce_mismatch` is not localized today; C3 may improve this). It also exposes a phishing surface: an attacker who can race the user with a nonce request from a malicious context (origin-confused link click) forces the legitimate flow to retry; the user assumes the failure was a glitch and re-signs. The retry attempt is itself safe (HttpOnly cookie + same-origin), but the user's tolerance for "sign again" is the social-engineering vector.

**Recommended control (backlog).** Replace the fixed cookie name with a per-challenge UUID cookie keyed by the nonce request's `wallet` value, allowing multiple concurrent challenges. The verify endpoint reads the cookie set whose value matches the wallet+nonce echoed in the body. Cost: a small server-side state schema; benefit: zero retry pressure under multi-tab. Not shipped in this PR because it has API-shape implications and should be designed jointly with C2 if their link variant changes the cookie shape.

### 5.2 Signature scope — login vs link-wallet (P0, fixed in this PR)

**Finding.** Today's SIWS message in `lib/payment/siws.ts:47-66`:

```
vizzor.ai wants you to sign in with your Solana account:
<wallet>

Sign in to vizzor.ai

URI: https://vizzor.ai
Version: 1
Chain ID: solana:mainnet
Nonce: <nonce>
Issued At: <iso>
Expiration Time: <iso>
```

The literal "Sign in to vizzor.ai" line is descriptive but not enforced. If C2 ships the link variant via the planned `buildSiwsLinkMessage` that swaps that single line to "Sign in to vizzor.ai to link wallet to Telegram user <id>", then a verification routine that does not assert which template is in use will accept either signature at either route. Concretely: an attacker can construct a phishing surface that captures a login signature, then replays its bytes against the `POST /api/wallet-links` endpoint to mint a binding to a TG account the attacker controls. The reverse is also dangerous: a link-signature is replayable as a login.

**Patch shipped.** This PR introduces a mandatory `Action: <enum>` line in the canonical message. The enum is `Login` or `Link Wallet`. The verify endpoint asserts the action it expects and rejects on mismatch. The check is in `verifySiwsScopedSignature` and the route handlers pass their expected action. Specifically:

- `app/api/auth/siws/verify/route.ts` recomputes the message with `action: 'Login'`.
- `app/api/wallet-links/route.ts` (when C2 lands it) MUST recompute with `action: 'Link Wallet'`. The signature scheme is unchanged (ed25519), so the C2 work consumes the new `buildSiwsMessage({ action: 'Link Wallet', ... })` signature.

This is a contract change. C2's PR must be coordinated to consume the new action arg. The PR body for this PR flags it.

**Replay across actions is impossible after this patch** because the action line is part of the message bytes; any signature for `Login` produces different bytes than `Link Wallet`, and ed25519 verification rejects the mismatch.

### 5.3 CAIP-122 / SIWE conformance

**Finding (informational).** The message format mostly conforms to SIWE-for-Solana (CAIP-122). It binds:

- Domain (`vizzor.ai`) — line 1
- Wallet (`opts.wallet`) — line 2
- URI (`https://vizzor.ai`) — explicit
- Chain ID (`solana:mainnet`) — explicit (matches CAIP-2)
- Nonce — explicit
- Issued At / Expiration Time — explicit ISO-8601

Gaps relative to a strict SIWE template:

- No `Statement:` line — we have "Sign in to vizzor.ai" as the descriptive line but it is not labeled `Statement:`. P3, cosmetic; some wallet UIs render `Statement:` more prominently. Backlog B8.
- No `Resources:` line — not applicable to v0.2.0; we do not authorize specific resources.
- No `Request ID` — not applicable; we have `Nonce`.

After §5.2 ships, the `Action:` line is an extension above the CAIP-122 baseline. Wallets that render the SIWS message in their approval UI will show it verbatim; this is the intended behavior — the user sees `Action: Link Wallet` and the prompt becomes self-explanatory.

### 5.4 `verifySiwsSignature` correctness

**Finding (informational).** The verifier in `lib/payment/siws.ts:73-102` is straightforward. It accepts base58 or base64 signature encodings, decodes the public key from base58, asserts canonical lengths (64-byte signature, 32-byte public key), and calls `nacl.sign.detached.verify`. The `try/catch` around the verify call swallows the tweetnacl exception and returns false, which matches the expected behavior of a verifier (no information leak about why the signature failed).

The pubkey length check (`publicKey.length !== 32`) catches malformed wallets early. The signature length check rejects truncated or padded sigs. Both are pre-conditions for `nacl.sign.detached.verify` and prevent the verifier from spending CPU on impossible inputs.

No correctness gap. The library choice (`tweetnacl` 1.0.3) is the upstream Solana convention; CVE-clean as of this RFC's publication.

## 6. Burn-verify audit findings

### 6.1 Persistent replay cache (P0, patched in this PR)

**Finding.** The in-memory `usedSignatures` map previously held in `lib/solana.ts` survived only as long as the Node process. A restart wiped it. If a user's burn signature is within the 5-minute on-chain replay window AND the process restarted in that window, the signature was replayable against `/api/predict` once more, granting an extra paid prediction.

**Patch shipped.** `lib/payment/replay-cache.ts` exports `hasSignature(sig)` and `rememberSignature(sig)` backed by the `signature_replay_cache` SQLite table. `lib/solana-server.ts:verifyBurnTx` calls these instead of the old in-memory Map. Eviction policy: cap at `VIZZOR_REPLAY_CACHE_SIZE` (default 4096) rows ordered by `seen_at` ASC; the insert drops the oldest 25% when over the cap (matches the in-memory policy verbatim). The table is additive (added to `runV020Migrations` in `lib/payment/db.ts`); a fresh deploy with no rows behaves identically to a fresh in-memory cache, preserving backwards compatibility.

**Schema.**

```sql
CREATE TABLE IF NOT EXISTS signature_replay_cache (
  signature  TEXT PRIMARY KEY,
  seen_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);
CREATE INDEX IF NOT EXISTS idx_replay_seen_at ON signature_replay_cache(seen_at);
```

The `signature` column is the same base58 signature string the on-chain check sees. Primary key gives O(log n) lookup and constant-time uniqueness rejection.

**Concurrency.** SQLite is single-writer; `better-sqlite3` is synchronous. The eviction step happens inside the same statement as the insert (a `DELETE ... WHERE seen_at IN (SELECT ... LIMIT ?)` after the `INSERT OR IGNORE`). Even under concurrent verify calls (Node single-threaded; concurrency is multi-process if deployed), the worst case is two inserts racing; the unique PK guarantees idempotency.

**Cross-restart compatibility.** Sessions confirmed under the old in-memory cache do not appear in the new SQLite table. A signature that was used pre-restart is NOT remembered post-restart; the only protection is the on-chain `REPLAY_WINDOW_SECONDS = 300`. This is unchanged from today's behavior — the migration does not regress.

### 6.2 ATA validation in `sumIncineratorTransfers`

**Finding (P3, informational).** The incinerator ATA derivation in `lib/solana.ts` is correct:

```ts
incineratorAta = deriveAssociatedTokenAddress(
  new PublicKey(INCINERATOR_ADDRESS),
  new PublicKey(expectedMint),
);
```

`deriveAssociatedTokenAddress` uses the canonical `[owner, TOKEN_PROGRAM_ID, mint]` PDA derivation under the Associated Token Program ID. The comparison `if (dest === incineratorAta)` is exact-string. There is no permissive prefix match, no case-insensitive match.

**Defense in depth.** When the parsed-instruction path does not yield a definitive match (transferred.matchedMint false OR matchedDestination false), the code falls back to walking `postTokenBalances` and matches `owner === INCINERATOR_ADDRESS && mint === expectedMint`. This is robust to instruction-parsing variations across RPC providers and to a malicious RPC that elides the parsed `info.destination`.

**Patch shipped (B1 / B9).** `verifyBurnTx` now runs `runAtaSelfTest(mint)` immediately after the mint check. The helper memoizes a once-per-process assertion that the derived incinerator ATA equals `process.env.VIZZOR_EXPECTED_INCINERATOR_ATA`. On mismatch the function latches `passed=false` for that mint and `verifyBurnTx` returns `{ ok: false, reason: 'ata_self_test_failed' }` for every subsequent call. When the env var is unset the self-test is a no-op so dev / staging stay functional. The expected value must be added to C6's `.env.example` registry; operators set it via the secrets manager. The combination of (a) local derivation with hard-coded program IDs, (b) startup self-test, and (c) `postTokenBalances` fallback closes the A4 attack surface.

### 6.3 Burn-amount slippage

**Finding (informational).** `verifyBurnTx` calls `burnAmount()` (default `1`) and asserts `transferred.amount < burnAmount()`. No upper bound. This is correct: a user paying more than the minimum should still be admitted. No gap.

### 6.4 Block-time replay window

**Finding (informational).** `ageSec > REPLAY_WINDOW_SECONDS` (300 seconds) rejects stale signatures. The window is the only on-chain replay protection that survives a server restart (per §6.1). The 5-minute choice balances clock skew tolerance against attacker window; reasonable for Solana finality plus typical user UX.

**No gap.** A separate process clock skew check is not warranted — the values come from Solana, not the local clock.

### 6.5 RPC failure handling

**Finding (informational).** `verifyBurnTx` returns `rpc_error` on any thrown exception from `getParsedTransaction`. The route at `/api/predict` propagates this as `402` to the client. The client retry path is on the UX side; nothing security-relevant here.

**No gap.** The behavior fails closed: a missing RPC reply does NOT grant admission.

## 7. Treasury custody review

### 7.1 Today's posture (v0.1.0)

The site holds only the public treasury addresses (`VIZZOR_TON_TREASURY`, `VIZZOR_SOLANA_TREASURY`). No private key material is on the host. The watcher reconciles incoming payments by address + memo and never signs anything. A1, A4, and A5 cannot drain the treasury through the site.

### 7.2 C1 introduces a mnemonic

The v0.2.0 C1 work derives per-session addresses from an HD master mnemonic (`VIZZOR_TREASURY_MNEMONIC`). The mnemonic is the new high-value secret. This RFC defines the custody requirements that C6 must satisfy.

#### Storage requirements (C6 must satisfy at least one)

1. Managed secret store (Doppler, Infisical, 1Password CLI) with read-only access scoped to the Node runtime user, encrypted at rest, audited reads.
2. KMS-wrapped env var: the mnemonic ciphertext lives in the env; the wrapping KMS key is held externally; the site decrypts on boot, holds the plaintext in process memory only.
3. (Not acceptable for production): plaintext env var. Acceptable only on dev and staging with a non-mainnet treasury.

#### Memory hygiene

- The mnemonic must not appear in any error message, log line, or stack trace. The HD derivation module in `lib/payment/hd.ts` (C1) must redact the mnemonic on any exception. Audit point for C1's PR.
- The mnemonic must not be persisted to SQLite or any other disk surface beyond the env-injection layer.

### 7.3 Rotation procedure

A treasury rotation is a high-stakes operation: it changes the canonical receiving address for the entire site. The procedure assumes the new mnemonic was generated on an air-gapped or otherwise-trusted workstation, never copied through clipboard managers, and that the resulting public address is announced to users via the standard release-notes channel.

1. Pause new session creation. Flip the feature flag `ACCEPT_VIZZOR_PAYMENTS=false` and `ACCEPT_TON_PAYMENTS=false` in the running site. Existing pending sessions continue to resolve against the old treasury until expiry.
2. Wait for the longest outstanding session to either confirm or expire (`PAYMENT_RATE_LOCK_SECONDS` minutes plus a buffer).
3. Sweep the old treasury balance to cold storage off-host. This is operator-side (cold-wallet ops); the site is unaware.
4. Deploy the new `VIZZOR_TREASURY_MNEMONIC` via the secrets manager (C6 path) or, in the v0.2.0 manual interim, via a tightly-scoped env update.
5. Re-enable payments. New sessions derive from the new mnemonic.
6. Update the public release notes and any marketing references to the treasury address (if any are shown in-product; today the dest address is server-canonical so this step is informational only).

**In-flight session implications.** Sessions created before step 1 carry the old `dest_address`; the watcher continues to poll the old treasury PublicKey for those sessions until each row's `expires_at`. The watcher's `solanaTreasury()` lookup is per-tick, so flipping the env after a restart picks up the new address for NEW polls. A clean rotation that empties all old `pending` sessions before step 3 is the safer ordering; an aggressive rotation that sweeps before all sessions expire risks confirming user payments against an address that has already been swept. The runbook above orders steps to avoid this.

### 7.4 Compromise response

If the mnemonic is suspected to be leaked:

1. Immediately flip the kill-switch (`ACCEPT_VIZZOR_PAYMENTS=false`, `ACCEPT_TON_PAYMENTS=false`).
2. Stop the watcher (the kill switches short-circuit `ensureWatcherStarted()`; restart all site processes to confirm).
3. Sweep both treasuries to cold storage. The attacker may have derived the same addresses; sweeping wins by being faster.
4. Rotate `VIZZOR_TREASURY_MNEMONIC` per §7.3.
5. File an incident report; if any user paid in the compromise window, reconcile manually and refund or honor the subscription out-of-band.

## 8. Dependency CVE sweep

`pnpm audit --json` run at 2026-06-02; results below. The audit reports 17 advisories across 7 distinct packages. Severity counts: 1 critical, 6 high, 9 moderate, 1 low. All advisories are on transitive dependencies; no top-level dependency in `package.json` is directly affected.

### 8.1 Findings table

| ID                  | Package         | Installed        | Patched in    | Severity     | Reachability                                              | Action |
| ------------------- | --------------- | ---------------- | ------------- | ------------ | --------------------------------------------------------- | ------ |
| GHSA-r88r-gmrh-7j83 | protobufjs      | 7.4.0, 7.5.5     | 7.5.5 / 7.5.8 | Critical+High | Transitive via `@solana/wallet-adapter-trezor` → `@trezor/connect` (client-only). Not imported at runtime — only Phantom + Solflare are instantiated in `components/wallet/wallet-provider.tsx`. Tree-shaken from prod bundle in principle, but the dependency graph is still resolved. | Bump via pnpm override (B10). |
| GHSA-3p86-9955-h393 | bigint-buffer   | 1.1.5            | unpatched     | High         | Transitive via `@solana/spl-token` → `@solana/buffer-layout-utils`. No fix available upstream. Reachability: the server's `lib/solana.ts` does NOT import `@solana/spl-token` — ATA derivation is implemented locally. Client wallet code may import it but does not feed attacker-controlled input. | Document as accepted risk; track upstream. (B11) |
| GHSA-vjh7-7g9h-fjfh | elliptic        | 6.6.1            | unpatched     | Low          | Transitive via `@solana/wallet-adapter-torus` (not instantiated in `components/wallet/wallet-provider.tsx`). The CVE is a side-channel timing leak on private-key operations; we do NOT do private-key ops in this codebase. | Document as accepted; backlog B12 to drop torus from the wallet bundle entirely. |
| GHSA-7gc6-qh9x-w6h8 | postcss         | 8.4.31 (via next), 8.5.15 (tailwindcss) | 8.5.10        | Moderate     | Dev/build tool. Not in the runtime bundle. Attack requires malicious CSS source; we control all CSS. | Accepted (build-only) — Next ships a patched version on its next minor; track. (B13) |
| GHSA-jq6h-vqv4-3wm3 | protobufjs      | 7.4.0            | 7.5.5         | Critical     | Same path as the first protobufjs row. | Same fix path (B10). |
| GHSA-cw7w-3gfp-2929 | ws              | 7.5.11, 8.18.0, 8.20.0 (some), 8.21.0 (devdep) | 8.20.1 | Moderate     | Mixed: 7.5.11 via `react-native` (devdep of `@react-three/fiber`) — not in server runtime. 8.20.0 via `@walletconnect/*` (client-only). 8.21.0 via `@fastify/websocket` is only inside `@vizzor/cli` (devdep, not bundled). | Build-time only; accepted (B14). |
| GHSA-9wv6-86v2-598j | lodash          | 4.17.21          | 4.17.23+      | Moderate/High | Transitive via `@walletconnect/universal-provider` (client wallet path) and `@vizzor/cli` (devdep). Server runtime does NOT use lodash. | Bump via pnpm override on the wallet-side path; devdep path is irrelevant. (B15) |
| GHSA-9p95-fxx7-mpmw | uuid            | 8.3.2, 14.0.0    | 11.1.1+       | Moderate     | Transitive via `@solana/web3.js` → `jayson` / `rpc-websockets`. The CVE requires a caller-controlled `buf` argument to `uuid.v3/v5/v6`; we do not call uuid directly. | Document as accepted with reachability note (B16). |

### 8.2 Top-level direct dependencies — manual review

The brief asks us to manually check the GitHub Advisory DB for: `@solana/web3.js`, `tweetnacl`, `bs58`, `@solana/spl-token`, `@tonconnect/ui-react`, `better-sqlite3`.

| Package             | Installed | Direct advisories (GitHub Advisory DB) | Notes |
| ------------------- | --------- | -------------------------------------- | ----- |
| `@solana/web3.js`   | 1.98.4    | No active advisories on 1.x at this RFC's publication. The package is the canonical Solana JS client and is actively maintained. Transitive issues counted in §8.1 (`protobufjs`, `uuid`). | Accept. |
| `tweetnacl`         | 1.0.3     | A 2017 NaCl-side advisory on signature malleability was closed with the 1.0.3 release. No active advisories. | Accept. |
| `bs58`              | 6.0.0     | No active advisories. The package is a thin base58 encoder; minimal attack surface. | Accept. |
| `@solana/spl-token` | 0.4.14    | No direct advisories. Transitive `bigint-buffer` per §8.1. | Accept with B11. |
| `@tonconnect/ui-react` | 2.4.4 | No active advisories on 2.4.x. | Accept. |
| `better-sqlite3`    | 12.10.0   | No active advisories on 12.x. Project actively maintained; native-binding integrity is the implicit assumption. | Accept. |

### 8.3 P0/P1 patches shipped in this PR?

No top-level dep needs to be bumped urgently. The `protobufjs` critical (P0 by CVSS) is unreachable at runtime (we do not import Trezor) and a bump via pnpm override changes the lockfile across multiple sub-branches simultaneously, which the architecture RFC flags as a high-conflict change. The override is filed as backlog B10 and the recommended sequencing is for the integrator to apply it on `release/v0.2.0` after all sub-branches merge, so the lockfile rebuild is a single mechanical commit.

Note: the integrator's deferral above is a judgment call. If the operator's threat profile elevates supply-chain compromise above merge-cycle pain, the override can land in this PR; the technical patch is documented in B10.

## 9. Bot shared-secret lifecycle (rotation procedure)

This section codifies the rotation procedure that the binding RFC §7 sketched. The concrete secret-store integration is deferred to C6; this RFC defines the contract.

### 9.1 Rotation goal

Replace `VIZZOR_BOT_SHARED_SECRET` without dropping any in-flight bot request. The bot and site are deployed independently; rotation must tolerate a deploy-order skew.

### 9.2 Mechanism — dual-accept window

The site accepts EITHER the current secret OR the next secret during the rotation window. The auth middleware reads both `VIZZOR_BOT_SHARED_SECRET` and `VIZZOR_BOT_SHARED_SECRET_NEXT`. Either match grants admission. The bot uses ONLY one secret at a time (the active value of `VIZZOR_BOT_SHARED_SECRET`). The site logs WHICH secret matched (boolean only; never the secret value) so the operator can confirm the migration.

### 9.3 Step-by-step

1. Operator generates a new secret on a trusted workstation:
   ```
   node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'
   ```
   The output is 43 characters of base64url-encoded entropy. Treat this as a token; never paste it into chat, never store it unencrypted.
2. Operator stages the new secret in the secrets manager (C6) under the key `VIZZOR_BOT_SHARED_SECRET_NEXT`. Production environment refreshes; the site picks up `BOTH` `VIZZOR_BOT_SHARED_SECRET` (the current) and `VIZZOR_BOT_SHARED_SECRET_NEXT` (the new candidate).
3. Operator probes the site from the bot host with the OLD secret. Expected: `200 ok` on `GET /api/subscriptions/lookup` for any well-formed query. Confirms the old secret is still accepted.
4. Operator rotates the bot's `VIZZOR_BOT_SHARED_SECRET` to the new value. The bot deploys.
5. Operator probes the site from the bot host with the NEW secret. Expected: `200 ok`. Confirms the new secret is accepted.
6. Operator promotes `VIZZOR_BOT_SHARED_SECRET_NEXT` to `VIZZOR_BOT_SHARED_SECRET` in the secrets manager and removes the old `VIZZOR_BOT_SHARED_SECRET_NEXT` slot. Site refreshes; only the new secret is accepted from this point.
7. Operator probes one more time with the OLD secret; expected: `401 unauthorized`. Confirms the old secret is fully revoked.

### 9.4 What breaks during the rotation window

Steps 1–3 are zero-downtime. Between steps 4 and 5 (bot deploys but site has not yet ack'd the new secret), the bot's calls succeed because the site is in dual-accept mode. Between steps 6 and the next refresh, the site is back to single-accept; if the bot still uses the old value (e.g. a delayed deploy), it sees 401 and falls back to the engine's free-tier quota for paid users. Mitigation: always deploy site first (dual-accept window opens), then bot, then close the dual-accept window.

### 9.5 Fail-closed semantics

- Missing `VIZZOR_BOT_SHARED_SECRET` in production: the site's `/api/health` payload exposes `bot_auth_configured: false`; bot routes return `503 service_unavailable`.
- Header missing or empty: `401 unauthorized`.
- Header set but does not match either accepted value: `401 unauthorized`.
- Secret comparison uses constant-time comparison (`crypto.timingSafeEqual`) to defeat timing oracles. Implementation note for C2: the comparison helper must be added in `lib/payment/bot-auth.ts` (C2 file) and shipped with C2's PR.

### 9.6 Audit trail

- Every successful bot-authenticated call is logged with: `route`, `telegram_user_id` (echoed from body), `accepted: 'current' | 'next'`, `at: <ts>`. The boolean of WHICH secret accepted is the rotation observable; the secret value itself is never logged.
- Every failed bot-authenticated call is logged with: `route`, `at: <ts>`, `reason: 'missing' | 'mismatch'`. Failed-auth count is a metric that ships in C6's monitoring patch.

## 10. Backlog (P2 and below)

The following findings are NOT patched in this PR. They are filed here as a checklist for follow-up cycles. Severity-tagged.

- [x] **B1 (P2)** *(shipped this PR)*: `runAtaSelfTest` memoizes a startup assertion that `deriveAssociatedTokenAddress(INCINERATOR, vizzorMint())` matches `VIZZOR_EXPECTED_INCINERATOR_ATA`. `verifyBurnTx` returns `ata_self_test_failed` on mismatch. No-op when the env var is unset (dev / staging).
- [ ] **B2 (P2)**: Per-IP rate limit (10/s) on `/api/grants/[code]/redeem`, `/api/subscriptions/lookup`, `/api/wallet-links/challenge`. Fail-closed.
- [ ] **B3 (P3)**: Emit a `bot_auth_failed_total` metric increment on every 401 from a bot-authed route. Alert on sustained >1/min.
- [ ] **B4 (P2)**: Per-challenge nonce-cookie naming (UUID-keyed) so concurrent SIWS challenges do not race-overwrite each other.
- [ ] **B5 (P3)**: Render the Telegram deep-link as a tap-to-open intent on mobile rather than an `<a href>` that leaks the code to referrer/history.
- [x] **B6 (P2)** *(shipped this PR)*: `vizzor.auth` and `vizzor.siws.nonce` cookies append `; Secure` when `NODE_ENV === 'production'`. Staging without TLS is unaffected.
- [ ] **B7 (P3)**: Store SHA-256 of `auth_sessions.token` instead of the raw token. Defends against stolen DB snapshots; v0.3.0 candidate due to migration cost.
- [ ] **B8 (P3)**: Add `Statement:` label to the SIWS message line so SIWE-strict wallet UIs render the statement prominently.
- [x] **B9 (P2)** *(shipped this PR)*: Closed by B1's self-test; same code path covers both.
- [ ] **B10 (P1)**: `pnpm overrides` to force `protobufjs >= 7.5.8`. Apply on `release/v0.2.0` after sub-branches merge, as a single mechanical commit.
- [ ] **B11 (P3)**: Track `bigint-buffer` upstream; consider replacing `@solana/spl-token` with `@solana/kit` once stable.
- [ ] **B12 (P3)**: Drop `@solana/wallet-adapter-torus` from the wallet bundle. Currently only Phantom + Solflare are instantiated in `components/wallet/wallet-provider.tsx`; torus is dead code that drags in `elliptic`. Use a slim wallet bundle.
- [ ] **B13 (P3)**: Track `postcss` for the next Next.js minor that bumps it to >= 8.5.10.
- [ ] **B14 (P3)**: Track `ws` across all transitive paths; consider `pnpm overrides` if a wallet path becomes reachable at runtime.
- [ ] **B15 (P3)**: `pnpm overrides` to force `lodash >= 4.17.23` on the wallet path.
- [ ] **B16 (P3)**: Same accept-and-track posture for `uuid`.

## 11. Findings table (severity summary)

| Severity | Count | IDs |
| -------- | ----- | --- |
| P0       | 2     | §5.2 SIWS cross-route replay (patched), §6.1 in-memory replay cache (patched) |
| P1       | 3     | §4.3 treasury custody (specification in §7), §4.6 bot-secret leakage limited by single-use grants (RFC §9 rotation), §4.14 RPC fail-closed (defer to C6) |
| P2       | 7     | §4.2 / §6.2 (B1, B9 — patched), §4.5 (B2), §4.8 (B4), §4.10 (B6 — patched), §4.13 (B7), §8.1 (B10) |
| P3       | 8     | §4.5 (B3), §4.9 (B5), §5.3 (B8), §8.1 (B11–B16) |

## 12. Verification

The patches shipped in this PR are verified by:

- `pnpm typecheck` passes on the branch HEAD after the SIWS action-scope changes, the persistent replay-cache wiring, the ATA self-test, and the `Secure` cookie additions.
- The `signature_replay_cache` migration is idempotent: re-running `init()` is a no-op (CREATE TABLE IF NOT EXISTS).
- The action-scope change is a CONTRACT change. `buildSiwsMessage` now REQUIRES an `action: SiwsAction` argument; the verify route at `app/api/auth/siws/verify/route.ts` asserts `cookieAction === bodyAction === 'login'` and rejects with `action_mismatch` otherwise. C2's PR must consume `buildSiwsMessage({ action: 'link', ... })` for the link-wallet route. This RFC and the PR body flag the coordination.
- ATA self-test latches on first mismatch and is mint-keyed: `runAtaSelfTest(mint)` re-validates if the configured `NEXT_PUBLIC_VIZZOR_MINT` changes at runtime, but a failure for a given mint persists until process restart.
- Cookie `Secure` flag is gated on `process.env.NODE_ENV === 'production'`; staging continues to issue plain cookies and is unaffected.

The audit findings listed in §10 are tracked in the v0.2.0 backlog under the labels they are tagged with. B1, B6, B9 are now closed by this PR.

---

## Appendix A: Forbidden attribution

Per `BRANCHING.md` Section 6, this RFC contains no `Co-Authored-By` trailer, no `Generated-By` trailer, no AI-tool references, and no emoji. Any example secret values use the literal token `<REDACTED>`.

## Appendix B: References

- `lib/payment/siws.ts` — `buildSiwsMessage` now takes a required `action: SiwsAction` argument and emits an `Action:` line above the `Nonce:` line. `parseSiwsAction` (new) is the boundary parser callers use on untrusted input. `verifySiwsSignature` is unchanged; the route layer composes the action assertion.
- `lib/payment/replay-cache.ts` — persistent burn-signature replay cache backing `hasSignature` / `rememberSignature`. Replaces the in-memory `usedSignatures` Map previously held in `lib/solana.ts`.
- `lib/solana.ts` — trimmed to client-safe constants and env helpers (`INCINERATOR_ADDRESS`, `solanaRpcUrl`, `vizzorMint`, `burnAmount`). Server-only verification moved to `lib/solana-server.ts` so the SQLite-backed replay cache is not pulled into the client bundle by the wallet components.
- `lib/solana-server.ts` (new, `import 'server-only'`) — `verifyBurnTx`, `BurnVerification`, `runAtaSelfTest`, `sumIncineratorTransfers`, `deriveAssociatedTokenAddress`. `verifyBurnTx` now (a) consumes the persistent cache via `hasSignature(sig)` / `rememberSignature(sig)` and (b) gates every call behind `runAtaSelfTest(mint)`. `BurnVerification.reason` gains `ata_self_test_failed`. Imported by `app/api/predict/route.ts` and `app/api/verify-burn/route.ts`.
- `lib/payment/db.ts` — gains `signature_replay_cache` table via `runV020Migrations`.
- `app/api/auth/siws/nonce/route.ts` — accepts `action` in body, embeds it as the 3rd dotted segment of the `vizzor.siws.nonce` cookie value, passes to `buildSiwsMessage`. Adds `; Secure` in production.
- `app/api/auth/siws/verify/route.ts` — parses cookie action and body action, asserts both equal the route's expected action (`login`), rejects with `action_mismatch` otherwise. Adds `; Secure` in production on both the nonce-delete and the `vizzor.auth` cookies.
- `components/auth/wallet-auth-button.tsx` — passes `action: 'login'` to both nonce and verify requests.
- `docs/rfc/v0.2.0/architecture.md` §4, §5, §6 — invariants, env-var registry, failure-mode catalog. `VIZZOR_EXPECTED_INCINERATOR_ATA` is a new env addition (C6 will register).
- `docs/rfc/v0.2.0/wallet-telegram-binding.md` §7 — bot shared-secret rotation contract. The link-wallet route landed there MUST consume `buildSiwsMessage({ action: 'link', ... })`.
