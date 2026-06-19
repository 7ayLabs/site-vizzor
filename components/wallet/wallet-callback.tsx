'use client';

/**
 * WalletCallback — handles the two return trips of the Phantom /
 * Solflare Connect Protocol.
 *
 * Lifecycle (driven entirely by URL params + sessionStorage):
 *
 *   step=connect → decrypt the connect response → POST SIWS nonce →
 *                  build signMessage deeplink → navigate to wallet.
 *
 *   step=sign    → decrypt the signature → POST SIWS verify → mutate
 *                  the session SWR cache → navigate to `returnTo`.
 *
 *   errorCode   → render the error UI with a retry CTA back to the
 *                  origin page.
 *
 * Why this is a separate route (not in-page): the user comes back from
 * Phantom into a brand new history entry, possibly on a freshly mounted
 * tab. A dedicated route keeps the URL parser, the SIWS dance, and the
 * second deeplink kickoff in one focused module instead of bolting them
 * onto every page that can connect a wallet.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useSWRConfig } from 'swr';
import { AlertCircle, Loader2, Check } from 'lucide-react';
import {
  buildSignMessageUrl,
  clearHandoff,
  decryptConnectCallback,
  decryptSignMessageCallback,
  encodeSignMessagePayload,
  loadHandoff,
  updateHandoff,
  type DeeplinkStep,
} from '@/lib/wallet/deeplink';
import { localizedAbsoluteUrl } from '@/lib/wallet/locale-url';
import { SupportCodeChip } from '@/components/ui/support-code-chip';
import { walletCallbackCode } from '@/lib/errors';

type Phase = 'verifying' | 'success' | 'error';

const KNOWN_ERROR_CODES = new Set([
  'handoff_missing',
  'connect_params_missing',
  'sign_params_missing',
  'shared_secret_missing',
  'unknown_step',
  'decrypt_failed',
  'connect_payload_missing_fields',
  'signature_missing',
  'nonce_failed',
  'verify_failed',
  'wallet_rejected',
]);

export function WalletCallback() {
  const params = useSearchParams();
  const t = useTranslations('auth.callback');
  const locale = useLocale();
  const { mutate } = useSWRConfig();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [errorKey, setErrorKey] = useState<string>('unknown');
  // Step-aware copy so the spinner says "Connecting" before sign and
  // "Signing" after it.
  const [step, setStep] = useState<DeeplinkStep | null>(null);
  // Guards against React 18 StrictMode double-mount in dev firing the
  // flow twice — which would consume the URL params and burn the
  // handoff state on the second pass.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const fail = (code: string) => {
      setErrorKey(KNOWN_ERROR_CODES.has(code) ? code : 'unknown');
      setPhase('error');
      clearHandoff();
    };

    void (async () => {
      // Wallet-side rejection / failure — surface and stop.
      const errorCode = params.get('errorCode');
      if (errorCode) {
        fail('wallet_rejected');
        return;
      }

      const rawStep = params.get('step');
      if (rawStep !== 'connect' && rawStep !== 'sign') {
        fail('unknown_step');
        return;
      }
      const currentStep: DeeplinkStep = rawStep;
      setStep(currentStep);

      const handoff = loadHandoff();
      if (!handoff) {
        fail('handoff_missing');
        return;
      }

      if (currentStep === 'connect') {
        const phantomPub = params.get('phantom_encryption_public_key');
        const nonceParam = params.get('nonce');
        const dataParam = params.get('data');
        if (!phantomPub || !nonceParam || !dataParam) {
          fail('connect_params_missing');
          return;
        }
        let decrypted;
        try {
          decrypted = decryptConnectCallback({
            phantomPublicKey: phantomPub,
            nonce: nonceParam,
            data: dataParam,
            dappSecretKey: handoff.dappSecretKey,
          });
        } catch (e) {
          fail((e as Error).message);
          return;
        }

        // Mint the SIWS message for this wallet now, while we have a
        // live signing session token from the wallet.
        let nonceData: {
          ok: boolean;
          message?: string;
          issuedAt?: string;
          expiresAt?: string;
          reason?: string;
        };
        try {
          const res = await fetch('/api/auth/siws/nonce', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              wallet: decrypted.walletAddress,
              action: 'login',
            }),
          });
          nonceData = await res.json();
        } catch {
          fail('nonce_failed');
          return;
        }
        if (!nonceData.ok || !nonceData.message) {
          fail('nonce_failed');
          return;
        }

        updateHandoff({
          walletAddress: decrypted.walletAddress,
          walletSessionToken: decrypted.sessionToken,
          sharedSecret: decrypted.sharedSecret,
          siwsMessage: nonceData.message,
          siwsIssuedAt: nonceData.issuedAt,
          siwsExpiresAt: nonceData.expiresAt,
        });

        const { nonce: encNonce, payload } = encodeSignMessagePayload({
          sharedSecret: decrypted.sharedSecret,
          sessionToken: decrypted.sessionToken,
          message: nonceData.message,
        });

        const signCallback = localizedAbsoluteUrl(
          '/wallet/callback?step=sign',
          locale,
        );
        const signUrl = buildSignMessageUrl({
          providerId: handoff.providerId,
          dappPublicKey: handoff.dappPublicKey,
          nonce: encNonce,
          payload,
          redirectLink: signCallback,
        });
        window.location.href = signUrl;
        return;
      }

      // step === 'sign'
      if (!handoff.sharedSecret || !handoff.walletAddress) {
        fail('shared_secret_missing');
        return;
      }
      const nonceParam = params.get('nonce');
      const dataParam = params.get('data');
      if (!nonceParam || !dataParam) {
        fail('sign_params_missing');
        return;
      }
      let sig;
      try {
        sig = decryptSignMessageCallback({
          sharedSecret: handoff.sharedSecret,
          nonce: nonceParam,
          data: dataParam,
        });
      } catch (e) {
        fail((e as Error).message);
        return;
      }

      let verifyData: { ok: boolean; reason?: string };
      try {
        const res = await fetch('/api/auth/siws/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            wallet: handoff.walletAddress,
            signature: sig.signature,
            action: 'login',
            issuedAt: handoff.siwsIssuedAt,
            expiresAt: handoff.siwsExpiresAt,
          }),
        });
        verifyData = await res.json();
      } catch {
        fail('verify_failed');
        return;
      }
      if (!verifyData.ok) {
        fail('verify_failed');
        return;
      }

      void mutate('/api/auth/session');

      const returnTo = handoff.returnTo;
      clearHandoff();
      setPhase('success');
      // Brief success hold so the user gets visual confirmation before
      // we navigate back. Matches the desktop modal's SUCCESS_HOLD_MS.
      window.setTimeout(() => {
        window.location.href = returnTo;
      }, 800);
    })();
  }, [params, locale, mutate]);

  return (
    <main className="relative isolate min-h-[60vh] flex items-center justify-center bg-[var(--bg)] px-5 py-16">
      <div className="w-full max-w-[380px] flex flex-col items-center gap-5 text-center">
        {phase === 'verifying' && (
          <>
            <span aria-hidden className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-[var(--fg-3)]">
              <Loader2 size={22} strokeWidth={2} className="motion-safe:animate-[spin_900ms_linear_infinite]" />
            </span>
            <div className="flex flex-col gap-1.5">
              <p className="text-[14px] font-medium text-[var(--fg)]">
                {step === 'sign' ? t('signing') : t('verifying')}
              </p>
              <p className="mono tabular text-[10.5px] text-[var(--fg-3)] uppercase tracking-[0.14em]">
                {step === 'sign' ? t('signingSubtitle') : t('verifyingSubtitle')}
              </p>
            </div>
          </>
        )}

        {phase === 'success' && (
          <>
            <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--accent-fg)]">
              <Check size={22} strokeWidth={2.4} />
            </span>
            <div className="flex flex-col gap-1.5">
              <p className="text-[14px] font-medium text-[var(--fg)]">
                {t('success')}
              </p>
              <p className="mono tabular text-[10.5px] text-[var(--fg-3)] uppercase tracking-[0.14em]">
                {t('successSubtitle')}
              </p>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:color-mix(in_oklab,var(--danger)_18%,var(--surface-2))] text-[var(--danger)]">
              <AlertCircle size={22} strokeWidth={2} />
            </span>
            <div className="flex flex-col gap-2 items-center">
              <p className="text-[14px] font-medium text-[var(--fg)]">
                {t(`error.${errorKey}` as 'error.unknown')}
              </p>
              <SupportCodeChip
                code={walletCallbackCode(errorKey).code}
                slug={walletCallbackCode(errorKey).slug}
                copyLabel={t('copyCode')}
                copiedLabel={t('codeCopied')}
              />
              <p className="mono tabular text-[10.5px] text-[var(--fg-3)] uppercase tracking-[0.14em]">
                {t('errorSubtitle')}
              </p>
            </div>
            <a
              href="/"
              className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--border)] px-4 text-[12px] font-medium text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
            >
              {t('home')}
            </a>
          </>
        )}
      </div>
    </main>
  );
}
