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
  type CatalogEntry,
} from './catalog';
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
 * Catalog hydration for the `/api/directory/catalog` route. Returns
 * every catalog entry plus an `installed` boolean per entry for the
 * given wallet (null wallet = anonymous = all false).
 */
export function getHydratedCatalog(wallet: string | null): Array<
  CatalogEntry & {
    installed: boolean;
    install_id: string | null;
    active_skill: boolean;
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
    };
  });
}

/* ------------------------------------------------------------------ *\
 * Outbound dispatch — fan a finalized prediction out to every active
 * webhook connector for a wallet.
\* ------------------------------------------------------------------ */

export interface DispatchPayload {
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  horizon: string;
  generated_at: string;
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

        await safeFetch(config.webhook_url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            connector_id: i.entry.id,
            payload,
          }),
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
