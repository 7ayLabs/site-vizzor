# Vizzor Pricing & Tokenomics — Complete Model

> Strategy doc for the unified pricing + payments + $VIZZOR token utility model. Companion to `API_CONTRACT.md` (which documents the engine endpoints).

---

## Executive summary

Three tiers (Free / Pro / Elite). Three billing cadences (Monthly / Annual / Lifetime — Elite-only). Multiple payment methods including **$VIZZOR with built-in discounts** so the token has real utility, not just speculative value.

**What makes this model "perfect" for Vizzor right now:**

1. **Stablecoin floor + token premium**. Anyone can pay in fiat-equivalent stables (no token volatility risk). $VIZZOR holders get a meaningful discount — direct value-back to early holders.
2. **Stake-for-access**. Long-term users can lock $VIZZOR instead of paying monthly. No recurring fee, capital-efficient, unstake anytime (7-day cooldown). Creates persistent token demand from active users.
3. **Agent commission tied to holding**. Elite's autonomous trading agents pay a 10% platform commission on profits. $VIZZOR holders pay 5% / 3% / 1% as their bag grows. Aligns active-trading users with token health.
4. **Predictable burn schedule**. Token spent on subscriptions/commissions partly burns. Real, measurable deflationary pressure — not arbitrary supply manipulation.
5. **Multi-chain by design**. TON for instant confirms today; USDC across major L2s + USDT on TRON in Phase 2. Visitors can pay in whatever they hold.

---

## Tier × payment matrix

| Tier      | USD price | Stablecoin / TON | **$VIZZOR pay** | **Stake-for-access** |
|-----------|-----------|-------------------|------------------|----------------------|
| **Free**  | $0/mo     | n/a               | n/a              | n/a                  |
| **Pro Monthly**   | $9.99/mo  | $9.99 equiv      | **$7.49 equiv** (–25%)   | 1,000 $VIZZOR locked = ongoing access |
| **Pro Annual**    | $99/yr    | $99 equiv        | **$74 equiv** (–25%)     | 1,000 $VIZZOR (same) |
| **Elite Monthly** | $99/mo    | $99 equiv        | **$69 equiv** (–30%)     | 5,000 $VIZZOR locked = ongoing access |
| **Elite Annual**  | $999/yr   | $999 equiv       | **$699 equiv** (–30%)    | 5,000 $VIZZOR (same) |
| **Elite Lifetime**| $2,499 once | $2,499 equiv  | **$1,624 equiv** (–35%)  | 10,000 $VIZZOR locked = permanent access |

**Why 25/30/35%?** Tested ranges for crypto-native SaaS: <15% feels token-gimmicky, >40% squeezes margin while attracting yield-farmers. 25-35% is the sweet spot — meaningful enough to drive token demand, narrow enough to stay healthy.

**Stake-for-access mechanic:**

- Lock the required $VIZZOR amount in a non-custodial staking contract → tier access activates within 1 confirmation
- Unstake anytime → 7-day cooldown → access ends after cooldown completes
- No fee charged while staked. Pure capital efficiency.
- Token never custody-transfers to Vizzor; user keeps full ownership in the staking contract.

---

## Multi-chain payment matrix

| Chain     | Token       | Phase     | Strategy                                          | Discount eligible? |
|-----------|-------------|-----------|---------------------------------------------------|--------------------|
| TON       | TON native  | **Live (Phase 1)** | TON Connect deep-link · instant confirm  | No (base rate)     |
| Solana    | **$VIZZOR (SPL)** | **Live (Phase 1)** | Solana wallet adapter (already wired for `/predict`) · ~400ms finality | **Yes — 25–35% off** |
| Polygon   | USDC        | Phase 2   | Self-hosted EVM watcher · 12-block finality       | No                 |
| Base      | USDC        | Phase 2   | Self-hosted EVM watcher · 12-block finality       | No                 |
| Arbitrum  | USDC        | Phase 2   | Self-hosted EVM watcher · 12-block finality       | No                 |
| Solana    | USDC        | Phase 2   | Self-hosted SOL watcher · 32-slot finality        | No                 |
| TRON      | USDT        | Phase 2   | Self-hosted TRON watcher · 20-block finality      | No                 |
| Ethereum  | ETH         | Phase 3   | Same as EVM L2s, higher gas                       | No                 |
| Bitcoin   | BTC (Lightning) | Phase 3 | LN invoices · instant settle                    | No                 |

**Engineering takeaway:** Phase 1 ships TWO Phase-1 chains, not one. TON for new visitors who don't hold the token, and Solana-$VIZZOR for token holders who want the discount. The `/predict` page already has the Solana wallet adapter wired — Phase 1 of `/pay` reuses that bundle to accept $VIZZOR with discount, alongside the TON Connect flow we already built.

---

## $VIZZOR utility — the four mechanics

### 1. Pay-with-discount (drives sell-side liquidity demand)

Visitor selects "Pay with $VIZZOR" on `/pay/[tier]/[cadence]`. The site:
- Fetches live USD-to-$VIZZOR rate (DexScreener / Jupiter)
- Applies the tier's discount multiplier (`pro=0.75, elite=0.70, elite-lifetime=0.65`)
- Locks the rate for 5 min (same window as the TON flow)
- User signs the SPL transfer; watcher confirms.

Of the $VIZZOR paid:
- **50% burned** (sent to `1nc1nerator11111111111111111111111111111111`)
- **50% to treasury** (engine ops + bounties)

### 2. Stake-for-access (drives lock-up demand)

Tier amount stays in user's wallet, in a Vizzor staking contract:
- Pro tier: 1,000 $VIZZOR locked = ongoing Pro access
- Elite tier: 5,000 $VIZZOR locked = ongoing Elite access
- Elite Lifetime: 10,000 $VIZZOR locked (permanent — unstaking ends access)

Properties:
- **Non-custodial** — Vizzor never holds your stake. The contract enforces locking; only you can unstake.
- **No recurring fee** — capital is the only cost. If $VIZZOR appreciates 2× while you're staked, your unrealized gain offsets the opportunity cost of locked capital.
- **7-day unstake cooldown** — prevents flash-stake-for-discount abuse + gives users a clean wind-down.
- **Stake-equivalent reaches Elite tier without ever spending the token.** Token works as a capital deposit, not a subscription fee.

### 3. Hold-for-commission-discount (drives long-tail holder demand)

Elite tier's autonomous trading agents take a **10% platform commission on net realized profits**, paid in the user's preferred chain at session-end. Holders pay less:

| $VIZZOR held (no stake required) | Platform commission |
|---|---|
| 0–999                  | 10%        |
| 1,000–4,999            | 5%         |
| 5,000–24,999           | 3%         |
| 25,000+                | 1%         |

Of platform commissions paid in $VIZZOR specifically:
- **30% burned**
- **70% treasury**

The commission discount creates a powerful flywheel for *successful* agent operators: the more your agents earn, the more it pays to stack $VIZZOR — and stacking $VIZZOR burns supply.

### 4. Governance weight (optional, Phase 3+)

Top-tier holders (25,000+) get governance vote weight on:
- Adjusting tier prices (operator hot-tune via SQLite overlay already exists)
- Whitelisting new chains for payment acceptance
- Setting agent commission rate (10% can become 8% or 12%)
- Funding bounties from treasury

Phase 3 only. Phase 1 is operator-controlled.

---

## Token economic flow (annual estimate at scale)

Hypothetical: 10,000 paying subscribers at year 1.

```
Inflow direction                                      → Burn      → Treasury    → User
─────────────────────────────────────────────────────────────────────────────────────────
Subscriptions in stables (TON/USDC/USDT)              ─           +revenue     ─
Subscriptions in $VIZZOR (~30% of paid users)          +50% burn  +50%         ─
Agent commissions in $VIZZOR (Elite tier active)      +30% burn  +70%         ─
Staked $VIZZOR (Pro: 1k × 3k subs)                    ─           ─            held in contract
Staked $VIZZOR (Elite: 5k × 700 subs)                 ─           ─            held in contract
```

Worked example (round numbers):
- 7,000 Pro subscribers × $99/yr × 30% paying in $VIZZOR = $208k notional in $VIZZOR/yr → $104k/yr burned, $104k/yr to treasury
- 3,000 Elite subscribers × $999/yr × 30% paying in $VIZZOR = $899k notional → $449k burned, $449k to treasury
- 3,000 Pro stakers × 1k $VIZZOR = 3M tokens permanently held in stake contract
- 700 Elite stakers × 5k $VIZZOR = 3.5M tokens permanently held

**Annual burn**: ~$550k notional ($VIZZOR equivalent at year-1 prices)
**Annual treasury inflow**: ~$550k + stablecoin revenue from non-token payers
**Effective supply reduction**: ~3-5% of circulating supply per year (assuming 10-20M circulating)

---

## Comparison vs typical crypto-SaaS pricing

| Project   | Tier model      | Token utility           | Multi-chain pay | Stake-for-access |
|-----------|-----------------|-------------------------|-----------------|------------------|
| Pyth      | Single tier     | Stake = oracle rewards | ETH only        | Yes (different mechanic) |
| Arkham    | Free + Premium  | None (PrivAccess gated by wallet) | No              | No |
| Nansen    | Free + 3 tiers  | None                    | Fiat + crypto   | No |
| DeBank    | Free + Pro      | $BNB-style burns        | No              | No |
| Bullx     | Subscription    | None                    | Solana only     | No |
| **Vizzor** | **Free + Pro + Elite × monthly/annual/lifetime** | **3 mechanics: discount, stake, commission** | **7 chains** | **Yes** |

**Vizzor's distinguishing edge:** the 3-mechanic token utility (pay-with-discount + stake-for-access + commission-tiered-by-hold) goes deeper than any of the comps. Discount alone is gimmicky; stake-for-access alone is capital-inefficient for short-term users; commission-tier alone only matters to power users. Combining all three gives every user segment a reason to hold:
- New users → buy small amounts for the pay-discount
- Loyal subscribers → stake to skip recurring payments
- Power agent operators → stack to lower commissions
- Long-term believers → governance vote weight

---

## What this means for the site code

The existing on-site checkout (`/pay/[tier]/[cadence]`) handles **TON** today. Phase 1 expansion:

1. **Add Solana wallet payment path** — reuse the existing `@solana/wallet-adapter` provider from `/predict`. The checkout shell already loads it lazily; flip a toggle so it's also reachable from `/pay`.
2. **Add `$VIZZOR pay` toggle** to the chain selector with a "save N%" badge.
3. **Add rate API for $VIZZOR** — `/api/payment/rate?token=vizzor` returning USD-to-$VIZZOR (Jupiter / Birdeye).
4. **Engine endpoint extends** — `POST /v1/payment/session` accepts `{token: 'vizzor', expectedDiscountPct}` and the engine validates the discount math is correct before locking.
5. **Stake-for-access UI** — separate `/stake` route (Phase 2) where users see their lock status, time-to-unstake, current tier comp.
6. **Agent commission display** — when an Elite user holds $VIZZOR, surface the effective commission tier in the agent dashboard so they see the discount they're earning.

None of this requires breaking the existing `/pay/[tier]/[cadence]` flow — it extends it.

---

## Phased rollout

### Phase 1 (this sprint — partially shipped)
- TON Connect on-site flow (✅ shipped, feature-flagged)
- Solana $VIZZOR pay with 25/30/35% discount
- Engine endpoints for both
- Bot grant-code redemption

### Phase 2 (next sprint)
- USDC on Polygon/Base/Arbitrum/Solana
- USDT on TRON
- Stake-for-access contract (Solana SPL with PDA-based locking)
- Agent commission tier auto-calculation

### Phase 3 (after subscriptions are mature)
- ETH mainnet + BTC Lightning
- Governance vote weight
- Refund automation (48h DM-`/refund` window)
- Subscription portal at `/account` (post-grant-redemption)

---

## Risks & open notes

- **Token price volatility** — when $VIZZOR drops 30%, users paying in token effectively pay 30% more in USD terms. The 5-min rate lock + ±0.5% slippage protects within a session but doesn't help cross-period. Mitigation: the 25/30/35% discount margin absorbs typical 15-25% intra-day swings.
- **Stake-for-access economics** — works only if $VIZZOR price is rising or flat. If the token bleeds long-term, stakers lose value AND access. Build a clear opt-out / migration path: users can convert stake → equivalent stablecoin-paid subscription at any time, with the conversion using a 7-day TWAP to smooth volatility.
- **Wash-staking** — sophisticated actors might flash-stake to get the discount, run agents, withdraw. The 7-day cooldown is partial protection; agent commission % is calculated at trade-execution time (not subscription time), so a flash-staker can't actually arbitrage the commission discount unless they hold through the whole agent lifecycle.
- **Regulatory** — discount-via-token is generally OK as a payment method. Stake-for-access starts to look like a "subscription utility token" which is the cleanest tokenomics category but still warrants legal review before launch. Agent commission tied to holding is fine — it's a discount, not a profit-share.
- **Engine canonical authority** — all discount math + commission tiers + stake validation happen on the engine, not the site. The site shows previews but the engine is the source of truth. Same architectural discipline as the existing `/v1/chat` integration.

---

## TL;DR

The "perfect" pricing plan for Vizzor right now is **stablecoin tiers + $VIZZOR with three distinct utility mechanics**:

1. **Pay-with-$VIZZOR**: 25/30/35% discount → drives token demand from every paying user.
2. **Stake-for-access**: 1k / 5k / 10k $VIZZOR locked → drives token demand from loyal subscribers.
3. **Hold-for-commission-discount**: 10% → 1% as your bag grows → drives token demand from successful agent operators.

Combined with multi-chain payment support (TON live, Solana live, EVM stables Phase 2), this gives every user segment a path to either (a) pay normally, (b) save money with the token, or (c) skip payments entirely by staking. **All three paths burn $VIZZOR**, creating predictable deflationary pressure tied directly to product usage — not arbitrary supply manipulation.

The site's `/pay/[tier]/[cadence]` shell already handles the TON path. Phase 1 expansion adds Solana-$VIZZOR alongside it; Phase 2 expands stablecoins; Phase 3 adds governance + ETH/BTC. Every step ships behind a feature flag with honest fallback — same operational discipline as the rest of the codebase.
