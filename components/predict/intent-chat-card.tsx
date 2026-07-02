'use client';

/**
 * IntentChatCard — the in-thread confirmation surface.
 *
 * Replaces the fixed-overlay modal for pending capability intents.
 * When a `send / flow / pay / auto` command lands, the shell renders
 * this card AT THE END of the chat thread, styled like a Vizzor
 * assistant response so the flow reads conversationally: the user
 * asked to move funds, and Vizzor answers with the intent to review
 * + a Sign & execute button. Rejecting sends a rejection audit and
 * dismisses the card; signing triggers the wallet prompt and settles
 * via `/api/execute-intent`.
 *
 * Trust model + wallet flow are identical to the old modal — same
 * canonical bytes signed, same route, same idempotency + spend caps.
 * Only the presentation moved from an overlay into the thread.
 *
 * v0.5.0.2 — Sign flow now mirrors the production-hardened
 * `SolanaPayButton` path: `sendTransaction(tx, connection)` (i.e.
 * Phantom's `signAndSendTransaction`), tx built with post-hoc
 * property assignment (constructor bag confuses the wallet-standard
 * serializer on some Phantom builds), blockhash sourced with a
 * public-RPC fallback chain, and errors classified into actionable
 * copy so an opaque "Unexpected error" from the extension surfaces
 * the specific reason (locked wallet / wrong cluster / etc.).
 *
 * The on-chain tx signature IS the authorization proof — server
 * marks the intent 'executed' with the tx_hash, no ed25519 verify
 * round-trip needed for SOL transfers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  clusterApiUrl,
  ComputeBudgetProgram,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { CoinIcon } from '@/components/ui/coin-icon';
import { cn } from '@/lib/utils';
import bs58 from 'bs58';
import {
  buildCanonicalIntent,
  shortAddress,
  type IntentNetwork,
  type PendingIntent,
} from '@/lib/capabilities/intent';
import { TradeTag } from '@/components/predict/trade-tag';

interface Props {
  intent: PendingIntent | null;
  onDismiss: () => void;
  onExecuted?: (result: {
    intent_id: string;
    tx_hash: string;
    network: IntentNetwork;
    explorer_url: string;
  }) => void;
  /**
   * Fires exactly once the card reaches a terminal state
   * (executed / failed / rejected / expired). The shell uses this to
   * inject a synthetic assistant turn summarizing the outcome so the
   * chat log carries the receipt even after the card scrolls out of
   * view. Duplicate firings are guarded internally by intent_id.
   */
  onFinalStatus?: (event: {
    intent_id: string;
    kind: IntentKindLite;
    symbol: string;
    amount: string;
    status: 'executed' | 'failed' | 'rejected' | 'expired' | 'scheduled';
    tx_hash?: string;
    explorer_url?: string;
    error?: string;
    /** v0.5.2 — set when `status === 'scheduled'`. Unix ms the
     *  payment will fire; used by the shell to narrate the receipt
     *  ("scheduled for {date}"). */
    execute_at?: number;
  }) => void;
}

type IntentKindLite = PendingIntent['kind'];

type CardState =
  | { kind: 'idle' }
  | { kind: 'reconnecting' }
  | { kind: 'signing' }
  | { kind: 'settling' }
  | {
      kind: 'success';
      txHash: string;
      network: IntentNetwork;
      explorerUrl: string;
    }
  /**
   * v0.5.2 — scheduled-payment persistent state. The wallet signed
   * the v2 canonical bytes; site persisted the signature with
   * status='signed' + execute_at. No on-chain tx has fired yet — the
   * card sits here until `payment_due` notification arrives at
   * execute_at and the user returns to broadcast.
   */
  | { kind: 'scheduled'; executeAt: number; network: IntentNetwork }
  | { kind: 'error'; message: string; canRetry: boolean }
  | { kind: 'rejected' };

export function IntentChatCard({
  intent,
  onDismiss,
  onExecuted,
  onFinalStatus,
}: Props) {
  const t = useTranslations('predict.capability.intent');
  const wallet = useWallet();
  const {
    publicKey,
    sendTransaction,
    connected,
    connect,
    wallet: selectedWallet,
  } = wallet;
  const { setVisible } = useWalletModal();
  const { connection: appConnection } = useConnection();

  // Resolve the cluster label ('mainnet-beta' | 'devnet' | 'testnet').
  // The wallet-adapter's `sendTransaction` broadcasts through the
  // extension's own RPC based on the chain hint the wallet-standard
  // adapter derived at connect time — so what matters is Phantom
  // being on the same cluster we're building blockhashes for. Locally
  // we default to devnet; operators can override via
  // NEXT_PUBLIC_CAPABILITY_TRANSFER_CLUSTER.
  const cluster = useMemo<'mainnet-beta' | 'devnet' | 'testnet'>(() => {
    const override = process.env.NEXT_PUBLIC_CAPABILITY_TRANSFER_CLUSTER;
    if (override === 'mainnet' || override === 'mainnet-beta') {
      return 'mainnet-beta';
    }
    if (override === 'testnet') return 'testnet';
    if (override === 'devnet') return 'devnet';
    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1');
    if (isLocalhost) return 'devnet';
    // Non-local: piggyback off the payment layer's cluster env so we
    // stay consistent with the SolanaPayButton path already in prod.
    const paymentNet = process.env.NEXT_PUBLIC_PAYMENT_NETWORK;
    if (paymentNet === 'mainnet') return 'mainnet-beta';
    if (paymentNet === 'testnet') return 'testnet';
    if (paymentNet === 'devnet') return 'devnet';
    return process.env.NODE_ENV === 'production' ? 'mainnet-beta' : 'devnet';
  }, []);

  const transferConnection = useMemo(() => {
    // On non-mainnet clusters we always want a fresh connection
    // pinned to that cluster; the app-wide connection is aligned to
    // whichever cluster the payment layer was configured with, and
    // it's cheap to hold a second Connection object.
    if (cluster === 'devnet') {
      return new Connection(clusterApiUrl('devnet'), 'confirmed');
    }
    if (cluster === 'testnet') {
      return new Connection(clusterApiUrl('testnet'), 'confirmed');
    }
    return appConnection;
  }, [appConnection, cluster]);
  const [state, setState] = useState<CardState>({ kind: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  /**
   * v0.5.2 — the card no longer auto-dismisses after 8s on success
   * (user regression: the receipt disappeared from the chat log,
   * and users complained they couldn't scroll back to review the
   * outcome). The card now stays mounted in the thread indefinitely
   * — the shell decides when to unmount it (never on success).
   * `finalStatusFired` guards the once-only `onFinalStatus` callback
   * so a state re-render doesn't inject a duplicate assistant turn.
   */
  const finalStatusFired = useRef<string | null>(null);

  // TTL clock — ticks every second so the countdown updates without
  // re-issuing the sign request.
  useEffect(() => {
    if (!intent) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [intent]);

  // Auto-flag expired intents proactively. The server refuses expired
  // ones with 410; showing the error here prevents a wasted wallet
  // prompt into a guaranteed rejection.
  useEffect(() => {
    if (!intent) return;
    if (state.kind === 'success' || state.kind === 'settling') return;
    if (intent.ttl_at <= now && state.kind !== 'error' && state.kind !== 'rejected') {
      setState({ kind: 'error', message: t('expired'), canRetry: false });
    }
  }, [intent, now, state.kind, t]);

  // Reset when a new intent lands (engine could emit a second one).
  useEffect(() => {
    setState({ kind: 'idle' });
    setNow(Date.now());
  }, [intent?.intent_id]);

  /**
   * Fire onFinalStatus exactly once per intent transition into a
   * terminal state. The intent_id gate handles React 18 strict
   * mode double-render + any effect re-run for the same intent.
   */
  useEffect(() => {
    if (!intent || !onFinalStatus) return;
    if (finalStatusFired.current === intent.intent_id) return;
    if (state.kind === 'success') {
      finalStatusFired.current = intent.intent_id;
      onFinalStatus({
        intent_id: intent.intent_id,
        kind: intent.kind,
        symbol: intent.symbol,
        amount: intent.amount,
        status: 'executed',
        tx_hash: state.txHash,
        explorer_url: state.explorerUrl,
      });
    } else if (state.kind === 'scheduled') {
      finalStatusFired.current = intent.intent_id;
      onFinalStatus({
        intent_id: intent.intent_id,
        kind: intent.kind,
        symbol: intent.symbol,
        amount: intent.amount,
        status: 'scheduled',
        execute_at: state.executeAt,
      });
    } else if (state.kind === 'error') {
      // Expired vs generic failure: expired-error has a specific
      // localized copy that came in via t('expired'). Comparing the
      // stored message to that string identifies the flavor without
      // adding a second state variant.
      const isExpired =
        state.message === t('expired') || intent.ttl_at <= now;
      finalStatusFired.current = intent.intent_id;
      onFinalStatus({
        intent_id: intent.intent_id,
        kind: intent.kind,
        symbol: intent.symbol,
        amount: intent.amount,
        status: isExpired ? 'expired' : 'failed',
        error: state.message,
      });
    } else if (state.kind === 'rejected') {
      finalStatusFired.current = intent.intent_id;
      onFinalStatus({
        intent_id: intent.intent_id,
        kind: intent.kind,
        symbol: intent.symbol,
        amount: intent.amount,
        status: 'rejected',
      });
    }
  }, [state, intent, onFinalStatus, t, now]);

  const secondsRemaining = useMemo(() => {
    if (!intent) return 0;
    return Math.max(0, Math.ceil((intent.ttl_at - now) / 1000));
  }, [intent, now]);

  const onSign = useCallback(async () => {
    if (!intent) return;

    // If the SIWS session is active but the wallet-adapter connection
    // dropped (page reload, user closed extension, etc.) we don't
    // give up — we transparently reconnect the adapter. `wallet` is
    // the selected wallet (Phantom, Solflare, etc.) that the user
    // authorised earlier; `connect()` prompts it to re-attach. If
    // nothing is selected yet we open the wallet-picker modal.
    if (!connected || !publicKey) {
      setState({ kind: 'reconnecting' });
      try {
        if (selectedWallet && typeof connect === 'function') {
          await connect();
        } else {
          setVisible(true);
          setState({ kind: 'idle' });
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'reconnect_failed';
        setState({
          kind: 'error',
          message: t('errorWalletDisconnected'),
          canRetry: true,
        });
        // eslint-disable-next-line no-console
        console.warn('[intent.sign] wallet reconnect failed', msg);
        return;
      }
      // After connect() resolves, useWallet's state re-renders on the
      // next tick — we let the user click Sign again rather than
      // recursing here (avoids re-entrancy corner cases with the
      // Solana adapter's async connection).
      setState({ kind: 'idle' });
      return;
    }

    // Network gate — SOL only for now. TON transfer builders land in
    // the engine follow-up PR.
    if (intent.network !== 'sol') {
      setState({
        kind: 'error',
        message: t.has('reasons.engine_settlement_pending' as never)
          ? t('reasons.engine_settlement_pending' as never)
          : 'Settlement for this capability is queued for the engine deploy.',
        canRetry: false,
      });
      return;
    }

    // v0.5.2 — coordinate-payment SCHEDULE flow. When the intent is a
    // payment with a future execute_at, sign the canonical bytes via
    // `wallet.signMessage` (off-chain — no on-chain tx yet), POST the
    // signature to /api/execute-intent, and flip the card to a
    // persistent "Scheduled" receipt. The site fires a payment_due
    // notification at execute_at; the user re-signs and broadcasts at
    // that point via the transfer path.
    if (intent.kind === 'payment') {
      setState({ kind: 'signing' });
      try {
        const signMessage = (wallet as { signMessage?: (msg: Uint8Array) => Promise<Uint8Array> }).signMessage;
        if (typeof signMessage !== 'function') {
          setState({
            kind: 'error',
            message: t.has('reasons.wallet_no_sign_message' as never)
              ? t('reasons.wallet_no_sign_message' as never)
              : 'Your wallet does not support message signing. Try Phantom or Solflare.',
            canRetry: false,
          });
          return;
        }
        // Rebuild the canonical bytes client-side from the same
        // PendingIntent shape. `buildCanonicalIntent` is the single
        // source of truth for the format; server and client running
        // it against the same input MUST produce byte-identical
        // output — that's the whole point of the domain separator.
        const canonical = buildCanonicalIntent(intent);
        const canonicalBytes = new TextEncoder().encode(canonical);
        let sigBytes: Uint8Array;
        try {
          sigBytes = await signMessage(canonicalBytes);
        } catch (signErr) {
          const errMsg =
            signErr instanceof Error ? signErr.message : String(signErr);
          const rejected = /reject|denied|declined/i.test(errMsg);
          setState({
            kind: 'error',
            message: rejected ? t('errorRejected') : t('errorGeneric'),
            canRetry: !rejected,
          });
          return;
        }
        // Encode the signature as base58 so the server (which decodes
        // via bs58) can verify against the wallet's pubkey.
        const signatureBase58 = bs58.encode(sigBytes);
        const res = await fetch('/api/execute-intent', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            intent_id: intent.intent_id,
            signature: signatureBase58,
            signed_by: publicKey.toBase58(),
          }),
        });
        const data = (await res.json()) as
          | {
              ok: true;
              scheduled: true;
              intent_id: string;
              execute_at: number;
              network: IntentNetwork;
            }
          | { ok: false; reason: string; upstream_body?: string };
        if (!res.ok || data.ok === false) {
          const reason = data.ok === false ? data.reason : `http_${res.status}`;
          const label = t.has(`reasons.${reason}` as never)
            ? t(`reasons.${reason}` as never)
            : reason;
          setState({
            kind: 'error',
            message: label,
            canRetry:
              reason === 'upstream_timeout' ||
              reason === 'upstream_unreachable',
          });
          return;
        }
        setState({
          kind: 'scheduled',
          executeAt: data.execute_at,
          network: data.network,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        // eslint-disable-next-line no-console
        console.warn('[intent.schedule] failed', errMsg);
        setState({
          kind: 'error',
          message: t('errorGeneric'),
          canRetry: true,
        });
      }
      return;
    }

    setState({ kind: 'signing' });
    try {
      // Build a real SOL transfer transaction. The wallet adapter's
      // `sendTransaction` handles Phantom's popup + broadcast to the
      // configured RPC (devnet in dev, mainnet in prod). This path
      // uses the wallet's stable SOL transfer signing path — way
      // more reliable than arbitrary-bytes signing on Phantom.
      const fromPubkey = publicKey;
      let toPubkey: PublicKey;
      try {
        toPubkey = new PublicKey(intent.to_addr);
      } catch {
        setState({
          kind: 'error',
          message: 'Recipient address is not a valid Solana public key.',
          canRetry: false,
        });
        return;
      }

      const amountSol = Number(intent.amount);
      if (!Number.isFinite(amountSol) || amountSol <= 0) {
        setState({
          kind: 'error',
          message: 'Amount must be a positive number.',
          canRetry: false,
        });
        return;
      }
      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      // Blockhash: use the same public-RPC fallback strategy that
      // SolanaPayButton uses — if the app's connection is flaky we
      // still get a fresh blockhash from a mainnet-independent public
      // RPC. Returns the connection that succeeded so subsequent
      // confirmations use the same endpoint that minted the blockhash
      // (Phantom's simulator gets very picky about cluster/blockhash
      // parity, and reusing the same RPC eliminates that class of
      // "Unexpected error" outright).
      let broadcastConnection: Connection = transferConnection;
      let blockhash: string;
      let lastValidBlockHeight: number;
      try {
        const prep = await getBlockhashWithFallback(cluster, transferConnection);
        broadcastConnection = prep.connection;
        blockhash = prep.blockhash;
        lastValidBlockHeight = prep.lastValidBlockHeight;
      } catch {
        setState({
          kind: 'error',
          message: t.has('reasons.rpc_unavailable' as never)
            ? t('reasons.rpc_unavailable' as never)
            : 'RPC unavailable. Try again in a moment.',
          canRetry: true,
        });
        return;
      }

      // Pre-flight balance check — mirrors the SolanaPayButton
      // pattern. Catching an insufficient balance here routes to a
      // specific banner ("insufficient balance") with a devnet
      // faucet hint, instead of letting Phantom bury the reason
      // inside its opaque "Unexpected error" (-32603). Buffer of
      // 80_000 lamports covers a SystemTransfer's fee + a small
      // safety margin. Diagnostics are logged so a failing balance
      // check surfaces in DevTools instead of a silent fallthrough.
      const minRequired = lamports + 80_000;
      try {
        const balance = await broadcastConnection.getBalance(fromPubkey);
        // eslint-disable-next-line no-console
        console.info('[intent.sign] balance check', {
          wallet: fromPubkey.toBase58(),
          cluster,
          rpc: broadcastConnection.rpcEndpoint,
          balanceLamports: balance,
          balanceSol: balance / LAMPORTS_PER_SOL,
          requiredLamports: minRequired,
          requiredSol: minRequired / LAMPORTS_PER_SOL,
        });
        if (balance < minRequired) {
          setState({
            kind: 'error',
            message: t.has('reasons.insufficient_balance' as never)
              ? t('reasons.insufficient_balance' as never)
              : cluster === 'devnet'
                ? `Insufficient devnet SOL. Fund ${fromPubkey.toBase58()} via https://faucet.solana.com and retry.`
                : 'Insufficient SOL for this transfer + network fee.',
            canRetry: true,
          });
          return;
        }
      } catch (balErr) {
        // eslint-disable-next-line no-console
        console.warn('[intent.sign] balance check threw — proceeding', balErr);
      }

      // Build a legacy Transaction with EXPLICIT ComputeBudget
      // instructions. Rationale — Phantom auto-injects
      // `setComputeUnitPrice` + `setComputeUnitLimit` when it
      // processes a legacy `signAndSendTransaction`; that mutation
      // happens AFTER the wallet-adapter promise chain is set up
      // against the original tx shape, and Phantom's async response
      // then rejects with the opaque `-32603 "Unexpected error"`
      // even while its own popup renders correctly. Adding the
      // budget instructions ourselves makes Phantom detect them and
      // skip the auto-inject, so the promise resolves with the
      // signature. Same pattern Solana Pay / Jupiter / Raydium ship
      // in production.
      //
      // Numbers:
      //   • setComputeUnitLimit 200_000  → System transfer needs
      //     ~450 CU; 200k is the tiniest round number that leaves
      //     comfortable headroom without paying for CUs we don't use.
      //   • setComputeUnitPrice 1 µlamport → priority fee ≈ 200 lamports
      //     on top of the 5000-lamport base fee. Total fee stays
      //     under the 80_000-lamport buffer we pre-checked against.
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = fromPubkey;
      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports,
        }),
      );

      // eslint-disable-next-line no-console
      console.info('[intent.sign] built tx', {
        blockhash,
        lastValidBlockHeight,
        rpc: broadcastConnection.rpcEndpoint,
        walletAdapterName: selectedWallet?.adapter.name,
      });

      // ONE wallet call. The wallet-adapter routes through the
      // wallet-standard `signAndSendTransaction` feature which is
      // the same path every production Solana dApp uses. Racing this
      // against a second call (Phantom direct provider, signTransaction,
      // etc.) confuses Phantom's message channel and produces the
      // opaque -32603 "Unexpected error" we've been chasing.
      let signature: string;
      try {
        signature = await sendTransaction(tx, broadcastConnection);
      } catch (sendErr) {
        // Surface Phantom's SW-disconnect signature specifically —
        // no client code can recover from it, the extension itself
        // needs a reload.
        const errMsg =
          sendErr instanceof Error ? sendErr.message : String(sendErr);
        // eslint-disable-next-line no-console
        console.warn('[intent.sign] sendTransaction threw', { errMsg });
        const isSwDisconnect =
          /disconnected port|service worker|Attempting to use a disconnected/i.test(
            errMsg,
          );
        if (isSwDisconnect) {
          setState({
            kind: 'error',
            message:
              'Phantom\'s background process is disconnected. Open chrome://extensions, click the reload icon under Phantom, then retry. If that doesn\'t help, restart your browser.',
            canRetry: true,
          });
          return;
        }
        throw sendErr;
      }
      setState({ kind: 'settling' });
      await broadcastConnection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed',
      );

      // Record the confirmed tx on the server for the audit ledger
      // + settings history. Server just marks the intent 'executed'
      // with the tx_hash; no signature verification because the
      // tx signature ITSELF is the on-chain proof of authorization.
      const res = await fetch('/api/execute-intent', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent_id: intent.intent_id,
          tx_hash: signature,
          signed_by: publicKey.toBase58(),
        }),
      });
      const data = (await res.json()) as
        | {
            ok: true;
            tx_hash: string;
            network: IntentNetwork;
            explorer_url: string;
            replayed?: boolean;
          }
        | {
            ok: false;
            reason: string;
            upstream_body?: string;
            upstream_status?: number;
          };
      if (!res.ok || data.ok === false) {
        const reason = data.ok === false ? data.reason : `http_${res.status}`;
        const upstreamBody =
          data.ok === false ? data.upstream_body : undefined;
        const canRetry =
          reason === 'upstream_timeout' ||
          reason === 'upstream_unreachable' ||
          reason === 'upstream_error';
        // eslint-disable-next-line no-console
        console.warn('[intent.execute] settle failed', {
          status: res.status,
          reason,
          data,
        });
        // Always surface the actual reason to the user. If we have a
        // localized label use it; otherwise the raw reason token is
        // still more informative than "something went wrong", and
        // upstream_body carries the engine's error text when the
        // engine responded with a non-2xx.
        const label = t.has(`reasons.${reason}` as never)
          ? t(`reasons.${reason}` as never)
          : reason;
        const finalMessage = upstreamBody
          ? `${label} — ${upstreamBody.slice(0, 200)}`
          : label;
        setState({
          kind: 'error',
          message: finalMessage,
          canRetry,
        });
        return;
      }
      setState({
        kind: 'success',
        txHash: data.tx_hash,
        network: data.network,
        explorerUrl: data.explorer_url,
      });
      onExecuted?.({
        intent_id: intent.intent_id,
        tx_hash: data.tx_hash,
        network: data.network,
        explorer_url: data.explorer_url,
      });
      // No auto-dismiss — the card stays mounted so the user can
      // scroll back to review the executed receipt (with tx hash +
      // explorer link) at any point in the conversation. The shell's
      // onFinalStatus effect appends a synthetic Vizzor assistant
      // turn narrating the outcome so even if the user scrolls away,
      // the receipt lives on in the log.
    } catch (e) {
      // Unwrap common wrapped-error shapes the wallet-adapter uses
      // (`WalletSignMessageError.error` = original wallet error,
      // `cause` for standard Error chaining).
      const errAny = e as {
        message?: unknown;
        error?: unknown;
        cause?: unknown;
        name?: unknown;
      };
      const surfaceMsg =
        typeof errAny.message === 'string' ? errAny.message : 'unknown_error';
      const innerMsg =
        errAny.error && typeof (errAny.error as { message?: unknown }).message === 'string'
          ? String((errAny.error as { message: string }).message)
          : errAny.cause && typeof (errAny.cause as { message?: unknown }).message === 'string'
            ? String((errAny.cause as { message: string }).message)
            : '';
      const combined = innerMsg && innerMsg !== surfaceMsg
        ? `${surfaceMsg} — ${innerMsg}`
        : surfaceMsg;
      const rejected =
        /reject|denied|declined/i.test(combined) &&
        !/unexpected/i.test(combined);
      // "Unexpected error" from WalletSignMessageError usually
      // maps to Phantom being locked, popup blocked, or the wallet
      // extension paused. Surface an actionable hint instead of
      // the raw message.
      const isPhantomUnexpected =
        /WalletSignMessageError/.test(combined) ||
        /Unexpected error/i.test(combined);
      // eslint-disable-next-line no-console
      console.warn('[intent.sign] threw', {
        error: e,
        message: surfaceMsg,
        inner: innerMsg,
      });
      const label = rejected
        ? t('errorRejected')
        : isPhantomUnexpected
          ? `${t('errorGeneric')} — ${t.has('reasons.wallet_unexpected' as never) ? t('reasons.wallet_unexpected' as never) : 'Wallet returned "Unexpected error". Unlock your wallet, close any pending prompts, and try again.'}`
          : combined.length > 0 && combined !== 'unknown_error'
            ? `${t('errorGeneric')} — ${combined.slice(0, 240)}`
            : t('errorGeneric');
      setState({
        kind: 'error',
        message: label,
        canRetry: !rejected,
      });
    }
  }, [
    intent,
    wallet,
    sendTransaction,
    publicKey,
    connected,
    connect,
    selectedWallet,
    setVisible,
    transferConnection,
    cluster,
    t,
    onExecuted,
    onDismiss,
  ]);

  const onReject = useCallback(() => {
    setState({ kind: 'rejected' });
    // No auto-dismiss — rejection is a receipt too. The shell's
    // onFinalStatus effect will surface a "Rejected" Vizzor turn
    // and the tray icon un-arms on its own.
  }, []);

  if (!intent) return null;

  const kindLabel = t(`kinds.${intent.kind}`);
  const nowLocalHms = new Date().toLocaleTimeString(undefined, {
    hour12: false,
  });

  const isBusy = state.kind === 'signing' || state.kind === 'settling' ||
    state.kind === 'reconnecting';

  return (
    <div className="flex flex-col gap-1.5 motion-safe:vz-intent-card-in max-w-[520px]">
      {/* Compact header row — same shape as the assistant bubble
          timestamp so the card reads as a Vizzor response, not a
          floating card. Everything in tabular mono for calm. The
          TradeTag rides at the end so the header carries the intent
          id + status at a glance, matching the affordance used on
          the workflows page + alerts drawer. */}
      <div className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] flex items-center gap-2 flex-wrap">
        <span>VIZZOR · {nowLocalHms} · {kindLabel.toUpperCase()}</span>
        <TradeTag
          intentId={intent.intent_id}
          kind={intent.kind}
          symbol={intent.symbol}
          amount={intent.amount}
          status={
            state.kind === 'success'
              ? 'executed'
              : state.kind === 'scheduled'
                ? 'signed'
                : state.kind === 'rejected'
                  ? 'expired'
                  : state.kind === 'error'
                    ? 'failed'
                    : 'pending'
          }
        />
      </div>

      <div
        className={cn(
          'rounded-xl',
          'border border-[var(--border)]',
          'bg-[var(--surface)]',
        )}
      >
        {/* Title strip: single row, single line, single accent hue.
            No headers within headers, no decorative left stripe. */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border)]">
          <span className="text-[12.5px] text-[var(--fg)]">{kindLabel}</span>
          <div className="inline-flex items-center gap-1">
            <CoinIcon symbol={intent.symbol} size={12} />
            <span className="mono text-[10.5px] tabular text-[var(--fg-2)]">
              {intent.amount} {intent.symbol}
            </span>
            <span className="mono text-[9.5px] tabular text-[var(--fg-3)] ml-2">
              {secondsRemaining}s
            </span>
          </div>
        </div>

        {/* Fields — sender + receiver shown in full so the user
            can visually verify every character before signing.
            Addresses wrap on `break-all` since Solana base58 keys
            (~44 chars) don't fit on one line inside the scoped
            card width. Nonce stays short-formatted — it's the
            server's replay guard, not something a user should
            reason about character-by-character. */}
        <div className="px-3.5 py-2.5 grid grid-cols-[54px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          <FieldLabel>{t('from')}</FieldLabel>
          <FieldValue mono full>{intent.from_addr}</FieldValue>
          <FieldLabel>{t('to')}</FieldLabel>
          <FieldValue mono full>{intent.to_addr}</FieldValue>
          {intent.network_fee && (
            <>
              <FieldLabel>{t('fee')}</FieldLabel>
              <FieldValue muted>~{intent.network_fee}</FieldValue>
            </>
          )}
          {/* v0.5.2 — payment schedule row. Only rendered for the
              payment kind; shows the local-time formatted execute_at
              the user is about to authorize. Read-only in this cut —
              editing the schedule requires re-minting the intent to
              rebuild canonical bytes, follow-up. */}
          {intent.kind === 'payment' && typeof intent.execute_at === 'number' && (
            <>
              <FieldLabel>{t('schedule')}</FieldLabel>
              <FieldValue mono>
                {new Date(intent.execute_at).toLocaleString(undefined, {
                  hour12: false,
                })}
              </FieldValue>
            </>
          )}
          <FieldLabel>{t('nonce')}</FieldLabel>
          <FieldValue mono muted>
            {shortAddress(intent.nonce, 6, 4)}
          </FieldValue>
        </div>

        {/* Action / status row — one line, right-aligned. */}
        <div className="px-3.5 py-2.5 border-t border-[var(--border)] flex items-center justify-between gap-3">
          <div className="min-w-0 text-[10.5px] text-[var(--fg-3)]">
            {state.kind === 'success' ? (
              <a
                href={state.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mono tabular text-[var(--up)] hover:opacity-90 underline underline-offset-2"
              >
                {shortAddress(state.txHash, 6, 6)}
              </a>
            ) : state.kind === 'scheduled' ? (
              <span className="text-[var(--up)]">
                {t.has('scheduledFor' as never)
                  ? (
                      t as unknown as (
                        k: string,
                        v: Record<string, string>,
                      ) => string
                    )('scheduledFor', {
                      when: new Date(state.executeAt).toLocaleString(undefined, {
                        hour12: false,
                      }),
                    })
                  : `Scheduled for ${new Date(state.executeAt).toLocaleString()}`}
              </span>
            ) : state.kind === 'rejected' ? (
              <span>{t('errorRejected')}</span>
            ) : state.kind === 'error' ? (
              <span className="text-[var(--down)]">{state.message}</span>
            ) : (
              <span>{t('risk')}</span>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            {state.kind === 'success' ? (
              <button
                type="button"
                onClick={onDismiss}
                className={buttonTextCls}
              >
                {t('close')}
              </button>
            ) : state.kind === 'scheduled' ? (
              <button
                type="button"
                onClick={onDismiss}
                className={buttonTextCls}
              >
                {t('close')}
              </button>
            ) : state.kind === 'error' ? (
              <>
                <button
                  type="button"
                  onClick={onDismiss}
                  className={buttonTextCls}
                >
                  {t('close')}
                </button>
                {state.canRetry && (
                  <button
                    type="button"
                    onClick={onSign}
                    className={buttonPrimaryCls}
                  >
                    {t('retry')}
                  </button>
                )}
              </>
            ) : state.kind === 'rejected' ? (
              <button
                type="button"
                onClick={onDismiss}
                className={buttonTextCls}
              >
                {t('close')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onReject}
                  disabled={isBusy}
                  className={buttonTextCls}
                >
                  {t('reject')}
                </button>
                <button
                  type="button"
                  onClick={onSign}
                  disabled={isBusy || secondsRemaining <= 0}
                  className={buttonPrimaryCls}
                >
                  {state.kind === 'signing'
                    ? intent.kind === 'payment'
                      ? t.has('scheduling' as never)
                        ? t('scheduling' as never)
                        : t('signing')
                      : t('signing')
                    : state.kind === 'settling'
                      ? t('settling')
                      : state.kind === 'reconnecting'
                        ? '…'
                        : intent.kind === 'payment'
                          ? t.has('signAndSchedule' as never)
                            ? t('signAndSchedule' as never)
                            : t('sign')
                          : t('sign')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
      {children}
    </span>
  );
}

function FieldValue({
  children,
  mono = false,
  muted = false,
  full = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
  /** Show the whole value; break arbitrarily to fit the column
   *  width. Use for wallet addresses the user needs to verify. */
  full?: boolean;
}) {
  return (
    <span
      className={cn(
        full ? 'break-all' : 'truncate',
        mono && 'mono tabular',
        muted ? 'text-[var(--fg-3)]' : 'text-[var(--fg)]',
      )}
    >
      {children}
    </span>
  );
}

const buttonPrimaryCls = cn(
  'inline-flex items-center justify-center rounded-md h-6 px-2.5',
  'text-[10.5px] font-semibold mono tabular uppercase tracking-[0.16em]',
  'bg-[var(--fg)] text-[var(--bg)]',
  'hover:opacity-90 active:scale-95',
  'disabled:opacity-40 disabled:cursor-not-allowed',
  'transition-[opacity,transform] duration-150',
);

const buttonTextCls = cn(
  'inline-flex items-center justify-center h-6 px-1.5',
  'text-[10.5px] mono tabular uppercase tracking-[0.16em]',
  'text-[var(--fg-3)] hover:text-[var(--fg)]',
  'bg-transparent',
  'disabled:opacity-40 disabled:cursor-not-allowed',
  'transition-colors duration-150',
);

/**
 * Blockhash fetch with public-RPC fallback — mirrors the pattern
 * SolanaPayButton has been running in prod. If the app's connection
 * is throttled we try the cluster's known-good public RPCs in turn.
 * Returns the Connection that succeeded so subsequent broadcast +
 * confirm operations use the same endpoint that minted the
 * blockhash — Phantom's simulator is picky about blockhash/endpoint
 * parity and the mismatched pair is one of the root causes of the
 * opaque "Unexpected error" the extension throws.
 */
async function getBlockhashWithFallback(
  cluster: 'mainnet-beta' | 'devnet' | 'testnet',
  primary: Connection,
): Promise<{
  connection: Connection;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const fallbacks =
    cluster === 'mainnet-beta'
      ? [
          'https://solana-rpc.publicnode.com',
          'https://rpc.ankr.com/solana',
          clusterApiUrl('mainnet-beta'),
        ]
      : cluster === 'testnet'
        ? [clusterApiUrl('testnet')]
        : [clusterApiUrl('devnet')];

  // Try the app-provided connection first (it may be a paid RPC),
  // then walk the public fallback list.
  const candidates: Array<{ conn: Connection; label: string }> = [
    { conn: primary, label: primary.rpcEndpoint },
  ];
  for (const url of fallbacks) {
    if (url === primary.rpcEndpoint) continue;
    candidates.push({ conn: new Connection(url, 'confirmed'), label: url });
  }

  let lastError: unknown = null;
  for (const { conn, label } of candidates) {
    try {
      // 'finalized' commitment keeps the blockhash old enough that
      // every RPC on the cluster has seen it — Phantom's simulator
      // won't reject with "blockhash not found" the way it can with
      // a very fresh 'confirmed' blockhash.
      const bh = await conn.getLatestBlockhash('finalized');
      return {
        connection: conn,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      };
    } catch (e) {
      lastError = e;
      // eslint-disable-next-line no-console
      console.warn('[intent.blockhash] rpc failed', { rpc: label, e });
    }
  }
  throw lastError ?? new Error('rpc_unavailable');
}

