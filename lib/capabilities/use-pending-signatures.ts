'use client';

/**
 * usePendingSignatures — SWR hook returning the count of intents
 * currently awaiting the wallet's signature.
 *
 * Reads `/api/workflows?status=pending,signed` and counts everything
 * where the site is still expecting a wallet-side action. `signed`
 * counts too because a signed-but-not-yet-executed intent means the
 * user has committed but the engine hasn't confirmed the on-chain
 * broadcast yet — from a "you owe attention here" UX perspective it's
 * the same category as pending.
 *
 * Used by:
 *   - the sidebar Flujos NavLink to show an unread badge, so a user
 *     with a background tab and a queued transfer sees the count on
 *     any /app/* surface.
 *   - future: a top-of-chat notification banner for the current
 *     conversation.
 *
 * Not tier-gated at the hook level — free-tier wallets never mint an
 * intent (the create-intent route 402s them), so the count is
 * naturally 0 for those users. Piggy-backs on /api/workflows' SIWS
 * gate.
 */

import useSWR from 'swr';

interface WorkflowsResponse {
  ok: boolean;
  active_count?: number;
  groups?: Array<{
    conversation_id: string | null;
    intents: Array<{ status: string }>;
  }>;
  reason?: string;
}

const fetcher = async (url: string): Promise<WorkflowsResponse> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) return { ok: false };
  return (await res.json()) as WorkflowsResponse;
};

export function usePendingSignatures(opts: { enabled: boolean }): {
  count: number;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<WorkflowsResponse>(
    opts.enabled ? '/api/workflows' : null,
    fetcher,
    {
      // Refresh on focus so the count updates when the user comes
      // back to the tab after signing on their phone or another tab.
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    },
  );
  const count = data?.ok
    ? (data.groups ?? []).reduce(
        (acc, g) =>
          acc +
          g.intents.filter(
            (i) => i.status === 'pending' || i.status === 'signed',
          ).length,
        0,
      )
    : 0;
  return { count, isLoading };
}
