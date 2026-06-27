# Wallet Integration Test Matrix

Pre-release smoke tests for every PR that touches `components/wallet/*`,
`components/pay/*`, `lib/payment/*`, `middleware.ts` (the security
header block or the app-host rewrite), or `app/api/auth/siws/*`.

Each cell must be ticked off in the PR description (or in the release
notes) before merge to `main`.

## Coverage matrix

| Wallet | Chain | Connect (SIWS) | Sign tx | TonConnect Manifest |
| --- | --- | --- | --- | --- |
| Phantom Desktop | Solana mainnet | ✅ via `signIn()` | ✅ via `sendTransaction` | n/a |
| Phantom Mobile (in-app browser) | Solana mainnet | ✅ via deeplink + `signIn()` | ✅ | n/a |
| Solflare | Solana mainnet | ✅ via Wallet Standard | ✅ | n/a |
| Backpack | Solana mainnet | ✅ via Wallet Standard | ✅ | n/a |
| Brave Wallet | Solana mainnet | ✅ via Wallet Standard (registers as `"Brave Wallet"`, not impersonating Phantom) | ✅ | n/a |
| Tonkeeper | TON mainnet | n/a (TonConnect doesn't use SIWS) | ✅ via `sendTransaction` | ✅ manifest fetches cleanly |
| TON Space | TON mainnet | n/a | ✅ | ✅ |

`✅` = verified end-to-end on the latest stable release of that wallet
against the deployed environment named in the PR. `n/a` = not a
supported combination by the protocol spec, no test required.

## What "verified" means

- **Connect (SIWS)** — open the wallet selector at
  `app.vizzor.ai/{en|es|fr}/app/predict` while logged out, pick the
  wallet, approve the connect, approve the SIWS message. The
  connect prompt MUST show `"Vizzor"` + the Vizzor logo (not the
  wallet's generic "this dapp" fallback). After approval, the
  navbar shows the connected wallet, and a hard reload preserves
  the session.
- **Sign tx** — start a checkout at `/{locale}/pay/explorer/monthly`,
  click "Pay with SOL" (or "Pay with TON"), approve the
  transaction. The signature lands and `/pay/success` renders with
  the on-chain receipt link.
- **TonConnect Manifest** — from a clean browser, scan or paste a
  vizzor.ai TonConnect deeplink into Tonkeeper / TON Space. The
  wallet fetches `https://vizzor.ai/tonconnect-manifest.json` and
  the connect prompt renders the Vizzor name + icon.

## Verification commands (operator-side)

```bash
# RFC 9116 security.txt is served and unexpired
curl -fsS https://vizzor.ai/.well-known/security.txt | head -20

# TonConnect manifest fetchable cross-origin
curl -fsS -H "Origin: https://app.tonkeeper.com" \
  -I https://vizzor.ai/tonconnect-manifest.json | grep -i access-control

# Security header grade (manual, browser)
# → https://securityheaders.com/?q=vizzor.ai (target: A+)

# Internet.nl modern-web checks
# → https://internet.nl/site/vizzor.ai (target: all green)
```

## When a cell regresses

1. Bisect to the commit that introduced the regression.
2. File a sub-task under the open dApp trust epic; do NOT cut a
   release containing the regression.
3. If the regression is in a Wallet Standard discovery path
   (a wallet that previously worked stops being detected), check
   `components/wallet/wallet-provider.tsx` for any `wallets=[…]`
   injection — Wallet Standard discovery requires the array to be
   empty so the registry crawl runs.
4. If the regression is in the SIWS message body, verify
   `lib/payment/siws.ts:resolveSiwsContext()` still resolves
   `domain`, `uri`, and `chainId` from the request `Origin` header —
   any hard-coded value will cause SIWS validation to fail on
   wallets that pin the `domain` field to the page origin.

## Related artifacts

- `/.well-known/security.txt` — RFC 9116 disclosure pointer.
- `/legal/security` — published security policy.
- `public/tonconnect-manifest.json` — TON wallet identity manifest.
- `public/site.webmanifest` — PWA manifest (dApp identity for
  Solana wallets that follow the `<link rel="manifest">` chain).
