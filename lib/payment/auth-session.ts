/**
 * Server-side helpers for reading the auth-session cookie set by the
 * SIWS verify endpoint.
 *
 * The cookie is `vizzor.auth=<token>`; the token is a row in the
 * `auth_sessions` table whose `wallet_address` becomes the
 * authenticated wallet for the request.
 */

import { cookies } from 'next/headers';
import { getAuthSession, deleteAuthSession } from './db';
import { findActiveSubscriptionByWallet, type SubscriptionRow } from './db';

export const AUTH_COOKIE = 'vizzor.auth';

export interface ActiveSession {
  wallet: string;
  expiresAt: number;
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const row = getAuthSession(token);
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    deleteAuthSession(token);
    return null;
  }
  return { wallet: row.wallet_address, expiresAt: row.expires_at };
}

export async function getSubscriptionForActiveSession(): Promise<SubscriptionRow | null> {
  const sess = await getActiveSession();
  if (!sess) return null;
  return findActiveSubscriptionByWallet(sess.wallet, Date.now());
}
