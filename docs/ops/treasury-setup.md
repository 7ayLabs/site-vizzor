# Treasury setup — watch-only HD pool runbook

> **Audience**: operator (Zaid) provisioning the cold device and uploading the
> public-address pool to the VPS. Read once at first setup, then again every
> 3–6 months when refilling the pool.
>
> **Security model**: the seed lives only on a hardware wallet, offline. The
> VPS holds only the pre-derived **public** addresses. Even a full container
> compromise yields zero ability to move funds — the worst case is service
> disruption, never theft.

## Why watch-only HD instead of a single static treasury

A static treasury — one wallet receives every customer's payment — has two
cypherpunk-relevant flaws:

1. **Address reuse exposes the aggregate balance + customer set on-chain.** Any
   observer who knows your treasury address can graph every payment ever made
   to it and total your monthly revenue.
2. **Single point of custody** — the seed is on whatever device controls the
   treasury, and the operator usually ends up storing it somewhere
   inconvenient enough to be insecure.

The watch-only HD pool fixes both:

- Each customer pays to a unique pre-derived address. An observer who sees one
  payment only sees that one customer's tx into that one address.
- The seed lives on a hardware wallet, permanently offline. Operator never
  types the seed on a network-connected machine.

> Technical note: `@ton/crypto` and `@solana/web3.js` both use ed25519 with
> hardened-only derivation. Standard BIP-32 xpub watch-only derivation isn't
> possible for either chain — so we **pre-derive a pool offline** and upload
> just the public-address JSON. Same security property (no private key on
> server), same privacy property (no address reuse).

---

## One-time cold setup

### Step 1 — Generate the seed (per chain)

| Chain | Device | Derivation path |
|---|---|---|
| Solana | Ledger Nano / Trezor (Solana app installed) | `m/44'/501'/N'/0'` for N = 0..255 |
| TON | Ledger Nano (TON app) or Tonkeeper hardware mode | `m/44'/607'/0'/0'/N` for N = 0..255 |

**You will use the same hardware wallet for both chains** — Ledger supports
both with separate apps. The seed protects both chains; if it's compromised,
both treasuries are.

### Step 2 — Back the seed to steel

- **Steel plate** — Cryptotag, Cryostell, or similar. Fire / water / EMP
  resistant. Etch all 24 words in order.
- **Two geographic copies** — one in your safe at home, one in a different
  city (safety deposit box at a bank, family safe, attorney's office). Each
  copy is the full 24-word seed; recovery from either is sufficient.
- **Never photographed, never typed into a non-HW-wallet device, never spoken
  in a microphone-enabled room.** Recovery happens only on the HW wallet
  itself.

### Step 3 — Recovery drill

- Get a SECOND hardware wallet (same model or compatible).
- Use Backup #1 to recover the wallet. Confirm the derived address at index 0
  matches the production pool.
- Wipe the second HW wallet.
- Repeat with Backup #2.
- Put both steel plates away.

If either recovery fails, the steel is wrong. Re-etch before going to prod.

### Step 4 — Derive the address pool (offline)

#### Solana

On a **dedicated offline machine** (booted from a USB Linux live image, no
network, the machine is reset to factory immediately after this step):

```bash
# Connect the Ledger via USB.
# Install solana-cli on the live USB:
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Verify the device is detected:
solana-keygen pubkey usb://ledger

# Batch-derive 256 receive addresses:
for i in $(seq 0 255); do
  addr=$(solana-keygen pubkey "usb://ledger?key=$i/0")
  echo "{\"index\": $i, \"address\": \"$addr\"}"
done | jq -s . > sol-pool.json

# Verify the file:
jq 'length' sol-pool.json   # → 256
jq '.[0]' sol-pool.json     # → spot-check entry 0
```

#### TON

TON Ledger app has a similar offline derivation. Use the **official TON CLI**
or `tonkeeper-cli`:

```bash
# With the Ledger app open:
for i in $(seq 0 255); do
  addr=$(toncli derive --account=$i --device=ledger)
  echo "{\"index\": $i, \"address\": \"$addr\"}"
done | jq -s . > ton-pool.json
```

### Step 5 — OFAC screen

Before uploading, screen every address against the OFAC SDN list:

```bash
# Use the existing site-vizzor sanctions data:
cd ~/repos/site-vizzor
pnpm tsx scripts/screen-addresses.ts sol-pool.json ton-pool.json
```

Any match — abort, regenerate at a different `N` range, re-screen.

### Step 6 — Upload to the VPS

```bash
# Transfer over SSH (only public addresses, safe in transit):
scp sol-pool.json ton-pool.json root@vizzor.ai:/opt/7aylabs/secrets/

# On the VPS, lock down permissions:
sudo chmod 0400 /opt/7aylabs/secrets/sol-pool.json
sudo chmod 0400 /opt/7aylabs/secrets/ton-pool.json
sudo chown root:root /opt/7aylabs/secrets/*.json

# Record the sha256 hashes out-of-band (in your password manager) so a
# VPS-shell attacker who tampers with the file leaves a fingerprint:
sha256sum /opt/7aylabs/secrets/*.json
```

### Step 7 — Wire env vars

In `/opt/7aylabs/docker-compose.staging.yml` and the prod compose file:

```yaml
services:
  site-vizzor-staging:
    environment:
      VIZZOR_SOLANA_ADDRESS_POOL_PATH: /opt/7aylabs/secrets/sol-pool.json
      VIZZOR_TON_ADDRESS_POOL_PATH:    /opt/7aylabs/secrets/ton-pool.json
      SOLANA_RPC_URL_MAINNET:          "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
      SOLANA_RPC_URL_DEVNET:           "https://api.devnet.solana.com"
      VIZZOR_TON_RPC_URL_MAINNET:      "https://toncenter.com/api/v2/jsonRPC?api_key=YOUR_KEY"
      VIZZOR_TON_RPC_URL_TESTNET:      "https://testnet.toncenter.com/api/v2/jsonRPC?api_key=YOUR_KEY"
      NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS: "true"
      NEXT_PUBLIC_ACCEPT_TON_PAYMENTS:    "true"
      VIZZOR_BOT_TOKEN:                 "<shared with vizzor engine>"
    volumes:
      - /opt/7aylabs/secrets:/opt/7aylabs/secrets:ro
```

Then `docker compose pull && up -d --force-recreate`.

### Step 8 — Verify

```bash
# Health probe shows the pools as loaded + within watermark:
curl -s https://app.vizzor.ai/api/health | jq '{solanaPool, tonPool}'
# Expected: { size: 256, used: 0, remaining: 256, lowWatermark: false }

# Engine ↔ site webhook plumbing:
curl -H "X-Vizzor-Bot-Token: $TOKEN" \
  https://api.vizzor.ai/v1/internal/health-payments | jq
# Expected: { siteReachable: true, botTokenConfigured: true, ... }
```

End-to-end: pay $0.01 from a test wallet on devnet to address index 0. Within
~10s the watcher logs `[vizzor-watcher] confirmed ses_…` and a `subscriptions`
row appears in the DB.

---

## Pool refill (recurring, every 3–6 months)

The health endpoint fires `lowWatermark: true` when `remaining < 32`. When
you see this:

1. Boot the offline machine + Ledger.
2. Derive addresses at indices `256..511` (or wherever the last pool left off).
3. OFAC screen.
4. Append to the existing `sol-pool.json` / `ton-pool.json`. **Append, do not
   replace** — replacing breaks the `pool_state.next_index` counter mapping.
5. `scp` the updated file to the VPS. The pool reader picks it up on next
   read (mtime-based reload, no restart needed).
6. Verify: `curl .../api/health | jq '.solanaPool.size'` shows the new total.

---

## Operator sweep (consolidate funds)

When you want to consolidate accumulated payments into a cold-storage vault:

1. Connect the Ledger to a **clean offline machine** (NOT the VPS, never the
   VPS).
2. For each address that has received funds (query Solana / TON explorers for
   the consolidated address list — the site logs the per-session address in
   `audit_log`):
   ```bash
   solana transfer --from "usb://ledger?key=$i/0" \
                   --to $YOUR_COLD_VAULT $AMOUNT
   ```
3. Repeat for TON via Tonkeeper / Ton CLI.

The site never participates in the sweep — only the operator's HW wallet
signs.

---

## Rotation (compromised seed)

If you suspect the seed is compromised (lost device, suspected leak):

1. **Stop accepting new payments** by setting
   `NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS=false` and
   `NEXT_PUBLIC_ACCEPT_TON_PAYMENTS=false` in compose.
2. `docker compose up -d --force-recreate` — checkout now shows
   `payment_misconfigured` chip with Telegram fallback.
3. Generate a new seed on a fresh HW wallet (Steps 1–4 above).
4. Derive a new pool (Step 4), screen (Step 5), upload (Step 6), wire (Step 7).
5. Sweep any remaining funds from the old derived addresses using the OLD
   seed onto the new pool's index 0 (or directly to your cold vault).
6. Re-enable payments.
7. Destroy the old steel plates physically (cut with bolt cutters, dispose at
   separate locations).

In-flight sessions during the rotation window (≤ 5 minutes of rate-lock
lifetime) settle to the OLD addresses — sweep those once with the old seed,
then the rotation is complete.

---

## Future migrations

- **2-of-3 multisig** (Squads on Solana, TON Multisig on TON): when monthly
  revenue justifies the operational overhead (~$5k/mo float threshold).
  Documented in `docs/security/treasury-threat-model.md` § "Seed SPoF".
- **Privacy-preserving sweep** (CoinJoin / chain hop): post-revenue the
  consolidation step links your customer set back together. Layer a privacy
  mixer on the sweep when it becomes a real concern.
