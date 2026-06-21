# Security Incident Runbook

_Operator-facing. Pair with [`docs/rfc/v0.2.0/incident-response.md`](../rfc/v0.2.0/incident-response.md)
for the broader payment-incident procedures._

When something looks like a security incident — leaked credentials,
unauthorized lookups, on-chain anomalies, dependency CVE — work
through this page in order. Don't skip the comms template at the end.

---

## P0 — Bot shared secret leak

**Trigger:** the value of `VIZZOR_BOT_SHARED_SECRET` is or might be
public (committed to a repo, posted in chat, screenshotted, leaked by
a contractor).

1. **Rotate immediately.** Set `VIZZOR_BOT_SHARED_SECRET_NEXT` to a
   fresh 32-byte base64url string on the site host. Re-deploy.
   `lib/payment/bot-auth.ts` accepts either secret during the
   rotation window, so the bot keeps working.
2. **Deploy the new secret to the Telegram bot host.** It now sends
   the new value as `x-vizzor-bot-token`.
3. **Promote.** Move the new value from `_NEXT` to
   `VIZZOR_BOT_SHARED_SECRET`. Drop `_NEXT`. Re-deploy.
4. **Audit.** Query the audit log for unauthorized calls during the
   exposure window:
   ```bash
   sqlite3 .vizzor/site.db <<SQL
   SELECT occurred_at, event_type, outcome, ip_hash, ua_hash
   FROM audit_log
   WHERE event_type IN ('subscription.lookup','grant.redeem','wallet_link.create')
     AND occurred_at >= <epoch_ms_of_leak>
   ORDER BY occurred_at ASC;
   SQL
   ```
   Flag any cluster of `outcome='found'` rows with an unfamiliar
   `ip_hash` for follow-up.
5. **Post-mortem.** Within 72h: how the secret leaked, what we
   learned, what's changing.

## P0 — Database compromise

**Trigger:** SQLite file (`.vizzor/site.db`) is accessed by an
unauthorized party (insider, supply-chain, host compromise).

1. **Invalidate every active auth session:**
   ```bash
   sqlite3 .vizzor/site.db 'DELETE FROM auth_sessions;'
   ```
   Every browser must re-sign-in. Since we store only
   `SHA-256(rawToken)` (Layer B1 of the security pass), an attacker
   with the DB file holds hashes, not session credentials — but we
   still rotate to be safe.
2. **Rotate the bot shared secret** (P0 procedure above).
3. **Rotate `VIZZOR_RATE_LIMIT_SALT`.** Old buckets become orphans;
   the daily sweep reclaims them within 24h.
4. **Snapshot the compromised DB to cold storage** for forensics
   before any cleanup that might destroy evidence.
5. **Notify affected users** if PII (Telegram user IDs, wallet ↔ TG
   bindings) was exposed. The audit log lets you scope precisely.

## P1 — Unauthorized subscription lookups

**Trigger:** spike in `subscription.lookup` rows in the audit log
from an unknown `ip_hash`.

1. **Rate limit kicks in** (5 req/s/IP for `/api/subscriptions/lookup`).
   Verify by hitting the route 10× in a tight loop:
   ```bash
   for i in $(seq 1 10); do
     curl -s -o /dev/null -w '%{http_code}\n' \
       -H "x-vizzor-bot-token: $BOT_SECRET" \
       'https://vizzor.ai/api/subscriptions/lookup?telegram_user_id=123';
   done
   ```
   Expect 200s then 429s.
2. **Rotate the bot shared secret** (P0 procedure).
3. **File a public post-mortem** if the access pattern looks like a
   real attacker, not a buggy bot integration.

## P1 — CVE in a dependency

**Trigger:** GitHub Dependabot alert, `pnpm audit --audit-level high
--prod` CI failure, or a public CVE for a package we use.

1. **Triage severity.** Critical / high: hotfix branch off
   `release/v0.2.x`. Medium / low: next regular release.
2. **Add to `pnpm.overrides`** in `package.json` if the package's
   own range doesn't have a patched version yet.
3. **Run the audit locally:** `pnpm audit --audit-level high --prod`.
   Re-run CI to confirm the gate passes.
4. **Deploy** + monitor `/api/health` for regressions.

## P2 — Watcher stuck

**Trigger:** `/api/health` reports
`subsystems.watcher.stale: true`, or no confirmations land for
>15 min during expected payment traffic.

1. Check the container logs for `[vizzor-watcher] tick failed:`.
2. Check Solana RPC availability:
   `curl -sf "$SOLANA_RPC_URL" -X POST -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`.
3. If the public fallback was being used in prod mainnet, set
   `SOLANA_RPC_URL_MAINNET` to a private RPC (Helius, Triton,
   QuickNode) and restart.
4. Document the incident — recurrent RPC issues warrant a vendor
   switch, not just a restart.

## P2 — CSP report flood

**Trigger:** `/api/security/csp-report` log lines exceed the rate
limit, or a single directive (e.g. `script-src`) shows up across
many distinct `documentPath` values.

1. **Identify the directive.** Tail logs for `[csp-report]
   directive=<x>`.
2. **Decide:** legitimate (a deploy missed a host on the allowlist
   in `middleware.ts buildCsp()`) or attacker-shaped (someone
   probing the policy).
3. If legitimate, add the host to the appropriate `connect-src` /
   `img-src` / `script-src` array and redeploy.
4. Only after the report log is quiet for ≥7 days, flip CSP from
   `Content-Security-Policy-Report-Only` to enforcing
   (`Content-Security-Policy`) in a follow-up commit.

## Communication template

Drop this in the public incident channel within 1 hour of detection.

> **[P0/P1] Vizzor incident — <one-line description>**
>
> _What happened:_ <single sentence, no jargon>.
>
> _Impact:_ <what users see, what's at risk>.
>
> _Status:_ <investigating / mitigated / resolved>.
>
> _What we're doing:_ <bullet list, present tense>.
>
> _Next update:_ <ISO timestamp>.
>
> _Incident lead:_ <name>.

Update the same post every 30 minutes until resolved. Post the
post-mortem within 72 hours.

## Kill switches

| Surface | Env var | Effect |
|---|---|---|
| Accept Solana payments | `NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS=false` | `/api/payment/session` returns "feature disabled"; watcher does not boot. |
| Bot routes | Set `VIZZOR_BOT_SHARED_SECRET` to a freshly-rotated value | All bot routes 401 until the bot's value is updated. |
| Retention sweep | Disable the GitHub Actions cron at `.github/workflows/retention-sweep.yml` | Retention pauses; no data leaks, just bloat. |
| CSP enforcement | Already in Report-Only mode — set `Content-Security-Policy-Report-Only` to a trivial policy in `middleware.ts` | Stops collecting reports while you investigate. |

## Post-incident

1. **Written post-mortem within 72 hours** — root cause, impact,
   timeline, what we changed, what we'd do differently.
2. **Update threat-model.md** if the incident reveals an adversary
   class we missed (A9, A10, …).
3. **Add a regression test** so the same root cause can't recur
   silently.
