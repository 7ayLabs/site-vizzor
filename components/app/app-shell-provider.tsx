'use client';

/**
 * AppShellProvider — single mount point for cross-surface app state.
 *
 * Mounts the Solana wallet adapter ONCE at the `/app/*` layout level
 * so wallet/SIWS state survives surface switches (Chat → Whales → Flow
 * → Billing) without remounting and breaking Phantom's connection.
 *
 * Also owns shared SWR fetches the surfaces read — `/api/auth/session`
 * and `/api/quota`. Surface components that already useSWR with these
 * keys benefit from cache dedup (no double-fetch), and `useAppShell()`
 * is the canonical accessor for components that prefer the context.
 *
 * `autoConnect={false}` mirrors the original PredictShell choice (see
 * commentary in `predict-shell.tsx` and `wallet-provider.tsx`) — the
 * silent connect attempt leaves Phantom in an intermediate state that
 * swallows subsequent explicit connects. The connect flow drives the
 * adapter explicitly via `useWallet().connect()`.
 */

import dynamic from 'next/dynamic';
import { createContext, useContext, type ReactNode } from 'react';
import useSWR, { type KeyedMutator } from 'swr';

const SolanaWalletAdapter = dynamic(
  () => import('@/components/wallet/wallet-provider'),
  { ssr: false, loading: () => null },
);

interface SubscriptionInfo {
  tier: string;
  cadence: string;
  expiresAt: number | null;
  isLifetime: boolean;
}

interface SessionState {
  ok: boolean;
  signedIn: boolean;
  wallet?: string;
  expiresAt?: number;
  subscription?: SubscriptionInfo | null;
}

interface QuotaState {
  connected?: boolean;
  tier?: 'free' | 'trial' | 'pro' | 'elite';
  trial?: {
    inTrial: boolean;
    daysRemaining: number;
    trialExpiresAt: number;
    dailyUsed: number;
    dailyCap: number;
  } | null;
  subscribed?: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
  exhausted?: boolean;
}

export interface AppShellContextValue {
  session: SessionState | undefined;
  quota: QuotaState | undefined;
  mutateSession: KeyedMutator<SessionState>;
  mutateQuota: KeyedMutator<QuotaState>;
}

const Ctx = createContext<AppShellContextValue | null>(null);

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
};

function AppShellState({ children }: { children: ReactNode }) {
  // Same SWR keys + refresh cadence the surface components already use,
  // so cache dedups across the shell + surface fetches. Mobile-safe
  // options match the quota fix shipped earlier.
  const { data: session, mutate: mutateSession } = useSWR<SessionState>(
    '/api/auth/session',
    fetcher,
    {
      refreshInterval: 20_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    },
  );
  const { data: quota, mutate: mutateQuota } = useSWR<QuotaState>(
    '/api/quota',
    fetcher,
    {
      refreshInterval: 15_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    },
  );

  const value: AppShellContextValue = {
    session,
    quota,
    mutateSession,
    mutateQuota,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AppShellProvider({ children }: { children: ReactNode }) {
  return (
    <SolanaWalletAdapter autoConnect={false}>
      <AppShellState>{children}</AppShellState>
    </SolanaWalletAdapter>
  );
}

export function useAppShell(): AppShellContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useAppShell must be used within <AppShellProvider>');
  }
  return ctx;
}
