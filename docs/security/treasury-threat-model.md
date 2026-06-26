# Treasury subsystem — STRIDE threat model

> **Scope**: the watch-only HD pool model that replaces the v0.1.x static
> treasury. Read alongside `docs/ops/treasury-setup.md` (operator
> procedures) and `lib/payment/address-pool.ts` (implementation).
>
> **Asset under protection**: customer payments in transit to the
> per-session derived address, and the operator seed that controls
> those addresses.

---

## STRIDE

### Spoofing

| Attack | Mitigation |
|---|---|
| Attacker pretends to be the treasury wallet, tricks a user into paying them | Per-session derived address is unique and rendered server-side from the operator-uploaded pool. A spoofed address would have to match the exact pool entry for the session ID — impossible without server access. |
| Site forges a payment that didn't happen | Site has zero ability to sign — even a full server compromise yields no fund movement. The on-chain tx hash is the source of truth; `audit_log` records it on confirmation. |

### Tampering

| Attack | Mitigation |
|---|---|
| VPS-shell attacker swaps the pool JSON file for one with attacker-controlled addresses | File bind-mounted **read-only** (mode 0400, `:ro` in compose). Operator records the sha256 out-of-band (password manager) and verifies on suspicion. Audit log line on every pool reload makes unexpected swaps grep-able. |
| Attacker modifies an in-flight session row to redirect payment | Session row's `dest_address` is set inside the same SQLite transaction as the pool index claim. The user signs a tx pointing at the rendered address; modifying the row after the fact does nothing — the user already signed and submitted to the on-chain address they saw. |
| Attacker corrupts the `pool_state.next_index` counter to re-allocate already-claimed addresses | Database-level write guarded by the same auth that protects every other site DB. Two sessions ending up at the same address is detectable in the audit log (same `dest_address` in two `payment_sessions` rows) and the watcher would credit both to whichever session matches the memo first. |

### Repudiation

| Attack | Mitigation |
|---|---|
| Customer claims they paid but the site says no | Every confirmed payment writes `audit_log` with `tx_sig` + `payer_address` + the derived `dest_address`. The on-chain tx hash is verifiable by anyone with an explorer. |
| Operator claims the customer didn't pay | Same audit log + the on-chain receipt the customer has from their wallet. Both parties can independently verify. |

### Information Disclosure

| Attack | Mitigation |
|---|---|
| Outside observer graphs the customer set from on-chain activity | **Per-session derived addresses** — each customer pays a unique address, so an observer sees one tx per address, not aggregate. The customer set is only re-aggregated when the operator sweeps (post-hoc, operator-timed). |
| Attacker reads the pool JSON and derives all future receive addresses | Pool contains **public** addresses only — disclosure is benign. The seed (private key) is not on the VPS. |
| Container logs leak the customer wallet address | Existing `lib/payment/log-redact.ts` truncates wallet addresses to first-4 / last-4 in every log line. Full addresses land in `audit_log` (DB-only, not log aggregator). |

### Denial of Service

| Attack | Mitigation |
|---|---|
| Attacker fires many session-create requests to exhaust the pool | Rate-limited at `lib/payment/rate-limit.ts` (`payment.session` key, 30/min per IP). Pool sized 256 entries (~6 months of moderate volume) with a low-watermark alert at < 32 remaining so the operator refills before exhaustion. |
| Attacker DOS the watcher RPC endpoint | Stale-while-error pattern in the watcher: session expires after 5 min of rate-lock; user retries; funds stay in the user's wallet until they actually sign. No funds at risk during the outage. |
| Pool exhaustion (operator forgot to refill) | Sessions return `payment_misconfigured` with a Telegram-bot fallback CTA. Customer can complete the purchase via the bot's HD-derived per-user address (separate flow, separate operator pool — see vizzor engine's `hd-wallet-payments.ts`). |

### Elevation of Privilege

| Attack | Mitigation |
|---|---|
| Attacker who compromises the VPS moves funds | **Impossible** — server has no private keys. Operator's HW wallet is the only signer. |
| Attacker who compromises the engine API server moves site funds | Same — engine is purely a tier-resolution + rate-quoting service; it has no payment authority. |

---

## Seed SPoF — explicit acknowledgment

The current model is a single 24-word seed protecting two chains.
**Lost / damaged / stolen** seed = all funds in the treasury are lost.

**Today's mitigation** (sufficient for revenue < $5k / month):
- Two geographic steel backups (Cryptotag / Cryostell) — fire / water / EMP resistant.
- Recovery drill once before going to prod, then put backups in
  separate safes.
- Hardware wallet is not single-use — keep a spare in case the primary fails.

**Planned mitigation** (when revenue justifies operational overhead):
- **2-of-3 multisig**:
  - Solana → [Squads](https://squads.so/) (production-grade, formally verified).
  - TON → [TON Multisig](https://ton.org/) (native primitive).
- Three signers, threshold 2:
  1. Operator's daily-use HW wallet (Ledger / Tonkeeper HW).
  2. Operator's remote-safe HW wallet (different physical location).
  3. Trusted third party (lawyer / family member with signing instructions
     in a sealed envelope).
- Any 2 signers can move funds; any 1 signer alone cannot.
- Lost seed scenarios:
  - 1 of 3 lost → still safe, no funds at risk. Replace with a fresh signer
    via on-chain multisig governance.
  - 2 of 3 lost → migration window to a new multisig before funds are
    irrecoverable. Document this scenario in the rotation runbook.

Migration trigger: monthly revenue >= $5k OR treasury balance >= $20k float.

---

## Known limitations

- **No privacy-preserving sweep** — when the operator consolidates funds from
  many derived addresses into a single cold vault, the consolidation transaction
  links all the per-customer addresses together on-chain. An observer who
  was already watching all the per-customer addresses (e.g. by aggregating
  every confirmed payment from the site's audit log, if leaked) could
  reconstruct the customer set at sweep time.
  - **Mitigation today**: time the sweep batches to break the correlation
    (sweep one address per week, not all 256 in one tx).
  - **Future mitigation**: route the sweep through a CoinJoin (Solana lacks
    a mature option; TON has Tonkeeper Privacy and similar) or chain-hop the
    funds before consolidating.

- **OFAC SDN screen is point-in-time** — addresses screened at upload + at
  consumption. A payer address that becomes sanctioned after consumption is
  not retroactively flagged.
  - **Mitigation**: re-screen the audit log periodically; if a flagged payer
    appears, refund + cooperate with whatever enforcement is required.

- **Rate-lock window** (5 min) — a session that is paid in the 5th minute
  but doesn't confirm before the 5th minute closes is "expired" from the
  site's perspective. The funds are still received (the watcher will see
  them on the next tick), but the user has to manually contact support to
  link the payment to a subscription. Rare in practice — the watcher polls
  every 5–6 seconds and Solana / TON confirmation is near-instant.

---

## Audit log retention

Every confirmed payment + every blocked OFAC match writes to `audit_log`.
Retain indefinitely — these are evidence for refund disputes, tax filings,
and regulatory compliance. Out-of-band backup the SQLite DB nightly to a
separate machine; encrypt the backup with a key the operator controls.
