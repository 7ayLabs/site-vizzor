/**
 * Runtime helpers — turn the install ledger into something the predict
 * path and the dispatcher can consume.
 *
 *   getInstalledForWallet(wallet)
 *     One catalog-shaped entry per active install for the wallet, with
 *     the connector merged with its catalog metadata. The Directory
 *     UI hydrates from this. Anonymous callers receive an empty list.
 *
 *   getActivePluginIds(wallet)
 *     Subset of installs where category === 'plugin'. Engine query
 *     param `plugin_ids` is built from this list.
 *
 *   getActiveSkillId(wallet)
 *     Reads wallet_preferences.active_skill_id. Engine query param
 *     `skill_id` is built from this.
 *
 *   dispatchPrediction(wallet, prediction)
 *     Fan-out: for every active webhook connector for the wallet,
 *     POST the prediction payload via safeFetch. Failures are logged
 *     to the audit table and never propagate to the caller.
 *
 * All helpers are side-effect-free except dispatchPrediction.
 */

import {
  getEntry,
  loadCatalog,
  tierSatisfies,
  type CatalogEntry,
  type RequiredTier,
} from './catalog';
import type { EffectiveTier } from '@/lib/payment/tier-resolver';
import {
  getWalletPreferences,
  listActiveConnectionsForWallet,
  markConnectionUsed,
  type UserConnectionRow,
} from '@/lib/payment/db';
import { decrypt } from '@/lib/security/connector-crypto';
import { safeFetch } from '@/lib/security/safe-fetch';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';

export interface HydratedInstall {
  install_id: string;
  entry: CatalogEntry;
  installed_at: number;
  last_used_at: number | null;
}

export function getInstalledForWallet(wallet: string): HydratedInstall[] {
  const rows = listActiveConnectionsForWallet(wallet);
  const out: HydratedInstall[] = [];
  for (const row of rows) {
    const entry = getEntry(row.connector_id);
    if (!entry) continue; // catalog row removed since install — silently skip
    out.push({
      install_id: row.id,
      entry,
      installed_at: row.installed_at,
      last_used_at: row.last_used_at,
    });
  }
  return out;
}

export function getActivePluginIds(wallet: string): string[] {
  return getInstalledForWallet(wallet)
    .filter((i) => i.entry.category === 'plugin')
    .map((i) => i.entry.id);
}

export function getActiveSkillId(wallet: string): string | null {
  return getWalletPreferences(wallet)?.active_skill_id ?? null;
}

/**
 * Map the site's EffectiveTier shape to a RequiredTier. Trial users
 * get pro-equivalent access for catalog gating (matches the existing
 * predict-route policy where trial wallets see pro features). Free
 * returns null so only `required_tier: 'free'` entries pass.
 */
export function effectiveTierToRequired(
  effective: EffectiveTier | null,
): RequiredTier | null {
  if (!effective) return null;
  if (effective.kind === 'elite') return 'elite';
  if (effective.kind === 'pro') return 'pro';
  if (effective.kind === 'trial') return 'pro';
  return null;
}

/**
 * Enforce the catalog's required_tier against the caller's effective
 * tier. Returns null when access is granted; returns a stable reason
 * string when it's denied. Used by the install API + (defense in
 * depth) the engine-side skill resolver.
 */
export function tierGateForEntry(
  entry: CatalogEntry,
  effective: EffectiveTier | null,
): 'tier_required' | null {
  const caller = effectiveTierToRequired(effective);
  return tierSatisfies(caller, entry.required_tier) ? null : 'tier_required';
}

/**
 * Catalog hydration for the `/api/directory/catalog` route. Returns
 * every catalog entry plus an `installed` boolean per entry for the
 * given wallet (null wallet = anonymous = all false) and a `locked`
 * flag based on the caller's effective tier. `locked` is advisory —
 * never trust it on the server side; the install API re-checks
 * required_tier independently.
 */
export function getHydratedCatalog(
  wallet: string | null,
  effective: EffectiveTier | null,
): Array<
  CatalogEntry & {
    installed: boolean;
    install_id: string | null;
    active_skill: boolean;
    locked: boolean;
  }
> {
  const catalog = loadCatalog();
  const installs = wallet ? getInstalledForWallet(wallet) : [];
  const activeSkill = wallet ? getActiveSkillId(wallet) : null;
  const byId = new Map(installs.map((i) => [i.entry.id, i] as const));
  return catalog.entries.map((entry) => {
    const inst = byId.get(entry.id);
    return {
      ...entry,
      installed: inst !== undefined,
      install_id: inst?.install_id ?? null,
      active_skill: activeSkill === entry.id,
      locked: tierGateForEntry(entry, effective) !== null,
    };
  });
}

/* ------------------------------------------------------------------ *\
 * Outbound dispatch — fan a finalized prediction out to every active
 * webhook connector for a wallet.
 *
 * Every payload carries a Vizzor `source` block (name, icon, share_url
 * with a deterministic referral attribution token derived from the
 * wallet). The referral token isn't a wallet address — it's a stable
 * 16-char SHA-256 prefix so the brand never leaks the user's wallet
 * into a third-party channel while still letting us credit the
 * referrer when they click through. The receiving connector (Discord
 * bot, Slack workflow, custom webhook) renders the source block as a
 * branded embed at minimal cost.
\* ------------------------------------------------------------------ */

import { createHash } from 'node:crypto';

export interface DispatchPayload {
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  horizon: string;
  generated_at: string;
}

const BRAND_BASE_URL = 'https://vizzor.ai';
const BRAND_ICON_URL = `${BRAND_BASE_URL}/brand/vizzor_icon.png`;

function refTokenForWallet(wallet: string): string {
  return createHash('sha256').update(`vizzor.ref.${wallet}`).digest('hex').slice(0, 16);
}

export interface BrandedDispatchEnvelope {
  /** Schema version so receivers can branch on payload evolution. */
  schema_version: 1;
  connector_id: string;
  source: {
    name: 'Vizzor';
    url: string;
    icon_url: string;
    /**
     * Click-through URL the receiving channel renders. Carries an
     * opaque `ref` token (SHA-256 prefix of the wallet) so we can
     * credit click-through attribution without leaking the raw
     * wallet to a third-party Discord/Slack workspace.
     */
    share_url: string;
  };
  payload: DispatchPayload;
}

/**
 * Best-effort fan-out. Each connector's failure is isolated — one
 * 5xx never blocks the others, and the prediction itself is unaware
 * dispatch happened. Per the plan: predictions are stateless on the
 * engine side; the site owns delivery.
 */
export async function dispatchPrediction(
  wallet: string,
  payload: DispatchPayload,
): Promise<void> {
  const installs = getInstalledForWallet(wallet);
  const webhooks = installs.filter(
    (i) => i.entry.install_kind === 'webhook',
  );
  if (webhooks.length === 0) return;

  const ref = refTokenForWallet(wallet);
  const shareUrl = `${BRAND_BASE_URL}/predict?ref=${ref}`;

  await Promise.allSettled(
    webhooks.map(async (i) => {
      try {
        const row = (
          listActiveConnectionsForWallet(wallet) as UserConnectionRow[]
        ).find((r) => r.id === i.install_id);
        if (!row || !row.credentials_ciphertext || !row.credentials_iv || !row.credentials_tag) {
          return;
        }
        const config = JSON.parse(
          decrypt({
            ciphertext: row.credentials_ciphertext,
            iv: row.credentials_iv,
            tag: row.credentials_tag,
          }),
        ) as { webhook_url?: string };
        if (!config.webhook_url) return;

        const envelope: BrandedDispatchEnvelope = {
          schema_version: 1,
          connector_id: i.entry.id,
          source: {
            name: 'Vizzor',
            url: BRAND_BASE_URL,
            icon_url: BRAND_ICON_URL,
            share_url: shareUrl,
          },
          payload,
        };

        await safeFetch(config.webhook_url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Vizzor/0.4.1 (+https://vizzor.ai)',
          },
          body: JSON.stringify(envelope),
          timeoutMs: 3500,
        });
        markConnectionUsed(i.install_id);
      } catch (err) {
        recordAudit({
          eventType: 'directory.connector.circuit_open',
          actor: actorFromWallet(wallet),
          subject: i.entry.id,
          outcome: 'error',
        });
        // eslint-disable-next-line no-console
        console.warn(
          `[directory] dispatch failed connector=${i.entry.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );
}
