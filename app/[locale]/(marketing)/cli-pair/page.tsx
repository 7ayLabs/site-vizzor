/**
 * /cli-pair — Bridge between the Vizzor CLI's onboarding wizard and a
 * paid wallet identity on the website.
 *
 * Flow:
 *   1. The CLI wizard's wallet-pair step prints
 *      `${origin}/cli-pair?code=ABC123` and asks the operator to open it.
 *   2. This page renders one of two states:
 *      a. Not signed in -> "Connect wallet" CTA pointing at the existing
 *         /wallet/connect flow with a return-to back to this page so the
 *         operator lands here again after signing.
 *      b. Signed in     -> calls `/api/cli-pair/mint`, displays the
 *         vizzor_auth_v1 token in a copyable box.
 *   3. Operator copies, pastes into the wizard's "Paste the token from
 *      the browser:" prompt. Wizard verifies + persists.
 *
 * Server component — the mint happens via a fetch from a thin client
 * island so the token never lives in the React Server Component payload.
 */

import type { ReactElement } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { CliPairIsland } from '@/components/cli-pair/cli-pair-island';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string }>;
}

export default async function CliPairPage({ params, searchParams }: PageProps): Promise<ReactElement> {
  const { locale } = await params;
  setRequestLocale(locale);
  const { code } = await searchParams;
  const session = await getActiveSession();
  const isSignedIn = session !== null;
  const walletAddress = session?.wallet ?? null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-4 text-3xl font-bold tracking-tight">
        🪪 Pair your Vizzor CLI
      </h1>
      <p className="mb-8 text-zinc-400">
        Sign with your wallet to mint a short-lived token that links your CLI
        to your Vizzor plan (Free / Pro / Elite). Paste it back into the
        wizard when prompted.
      </p>

      {code ? (
        <div className="mb-6 rounded-md border border-zinc-700 bg-zinc-900/40 px-4 py-2 text-sm">
          <span className="text-zinc-500">Pair code:</span>{' '}
          <code className="text-zinc-200">{code}</code>
        </div>
      ) : null}

      <CliPairIsland
        isSignedIn={isSignedIn}
        walletAddress={walletAddress}
        code={code ?? null}
      />

      <p className="mt-10 text-xs text-zinc-600">
        The token is signed with HMAC-SHA256 against the site's shared
        secret. The engine + CLI both verify it locally — the secret
        never travels over the wire.
      </p>
    </main>
  );
}
