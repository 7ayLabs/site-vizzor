'use client';

/**
 * SolanaPayButton — initiates a native SOL transfer from the connected
 * wallet (via the Solana Wallet Adapter) to the session's destination
 * address. Attaches a memo carrying the session_id so the watcher can
 * demux confirmations.
 *
 * Wallet discovery: relies on the Solana Wallet Standard (registered
 * via `window.navigator.wallets`). Phantom 2024+, Solflare, Backpack
 * and Glow all register themselves there. The button drives the
 * selection itself via `select(name)` instead of asking the user to
 * pick from a modal, because we already render an inline detection
 * panel (WalletPickerPanel) that lists every discovered adapter.
 *
 * Click flow:
 *   1. No wallet selected → open the Wallet Adapter's standard modal
 *      (Phantom, Solflare, Backpack auto-discovered).
 *   2. Wallet selected but not connected → call `connect()`.
 *   3. Connected → build the tx (System transfer + Memo), sign + send.
 *
 * The button only signs & sends — confirmation is the watcher's job.
 * On signature, we hand the txSig up to CheckoutShield which transitions
 * the state machine to `paying` and starts polling.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { ConnectWalletAlert } from './connect-wallet-alert';

interface SolanaPayButtonProps {
  destAddress: string;
  /** Locked SOL amount from the payment session. */
  amount: number;
  /** session_id — embedded as a memo so the watcher can match. */
  sessionId: string;
  onSent: (signature: string) => void;
  onError: (msg: string) => void;
  disabled?: boolean;
}

const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
);
const LAMPORTS_PER_SOL = 1_000_000_000;

function rpcCandidates(): string[] {
  // Three explicit cluster cases plus a NODE_ENV-driven default. The
  // earlier two-branch form (mainnet / testnet only) collapsed the
  // 'devnet' value into the production fallback and shipped a mainnet
  // RPC to staging — `app.vizzor.ai` is built with
  // NEXT_PUBLIC_PAYMENT_NETWORK=devnet, so the bundle MUST round-trip
  // 'devnet' to api.devnet.solana.com, not to mainnet-beta.
  const raw = process.env.NEXT_PUBLIC_PAYMENT_NETWORK;
  const network: 'mainnet' | 'testnet' | 'devnet' =
    raw === 'mainnet' || raw === 'testnet' || raw === 'devnet'
      ? raw
      : process.env.NODE_ENV === 'production'
        ? 'mainnet'
        : 'devnet';

  const configured =
    network === 'mainnet'
      ? (process.env.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET ??
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL)
      : network === 'testnet'
        ? (process.env.NEXT_PUBLIC_SOLANA_RPC_URL_TESTNET ??
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL)
        : (process.env.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET ??
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL);

  const fallbacks =
    network === 'mainnet'
      ? ['https://solana-rpc.publicnode.com', 'https://rpc.ankr.com/solana']
      : network === 'testnet'
        ? ['https://api.testnet.solana.com']
        : ['https://api.devnet.solana.com'];

  return configured ? [configured, ...fallbacks] : fallbacks;
}

/**
 * Maps a raw wallet / RPC exception to one of our PaymentReason
 * codes so the banner shows accurate copy. The patterns cover what
 * Phantom + the Solana RPC actually throw — kept here next to the
 * code path that produces them so it's obvious why each branch exists.
 */
function classifyWalletError(msg: string): string {
  // User dismissed Phantom's approve dialog.
  if (/reject|denied|user rejected|cancel/i.test(msg)) {
    return 'wallet_rejected';
  }
  // Wallet is on the wrong cluster (Phantom emits "wrong network",
  // Solflare "cluster mismatch", Backpack "network mismatch"). We
  // catch the union so the banner can prompt a switch rather than
  // surfacing a generic error. Order matters: keep this above the
  // RPC-unavailable / insufficient-balance branches because cluster
  // mismatches sometimes co-emit "invalid blockhash" downstream.
  if (/wrong\s*network|network\s*mismatch|cluster\s*mismatch|wrong\s*cluster/i.test(msg)) {
    return 'wrong_network';
  }
  // Wallet/RPC pre-flight told us the payer has no devnet SOL. The
  // Solana RPC verbatim returns "Attempt to debit an account but found
  // no record of a prior credit" when balance is below the fee.
  if (
    /insufficient|debit an account|found no record|too little/i.test(msg)
  ) {
    return 'insufficient_balance';
  }
  // Blockhash race — the one we fetched expired before the wallet
  // signed and broadcast.
  if (/blockhash|expired|too old/i.test(msg)) {
    return 'rpc_unavailable';
  }
  // Network / RPC layer (5xx, timeout, DNS).
  if (/429|503|fetch failed|network|aborted|timeout/i.test(msg)) {
    return 'rpc_unavailable';
  }
  // Account doesn't exist — usually the treasury env was unset.
  if (/account does not exist|invalid account|invalid pub/i.test(msg)) {
    return 'invalid_destination';
  }
  // Unknown — surface a truncated diagnostic so the user can copy it
  // into support instead of staring at "Something went wrong."
  return `unexpected: ${msg.slice(0, 140)}`;
}

async function getBlockhashWithFallback(): Promise<{
  connection: Connection;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  let lastError: unknown = null;
  for (const url of rpcCandidates()) {
    try {
      const c = new Connection(url, 'confirmed');
      const bh = await c.getLatestBlockhash('confirmed');
      return {
        connection: c,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('rpc_unavailable');
}

export function SolanaPayButton({
  destAddress,
  amount,
  sessionId,
  onSent,
  onError,
  disabled,
}: SolanaPayButtonProps) {
  const t = useTranslations('pay');
  const { publicKey, sendTransaction, connected, connect, wallet } =
    useWallet();
  const [alertOpen, setAlertOpen] = useState(false);

  const handleClick = useCallback(async () => {
    try {
      // No wallet selected at all → pop the connect alert so the user
      // gets an explicit path. Selecting via the inline picker is the
      // happy path; the alert is the recovery for clicks that bypass it.
      if (!wallet) {
        setAlertOpen(true);
        return;
      }

      // Wallet selected (possibly from a previous SIWS sign-in) but
      // not yet connected on this page — try connect() silently. If
      // the extension rejects or times out, surface the alert.
      if (!connected || !publicKey) {
        try {
          await connect();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/rejected/i.test(msg)) {
            onError('wallet_rejected');
            return;
          }
          setAlertOpen(true);
          return;
        }
        if (!publicKey) {
          setAlertOpen(true);
          return;
        }
      }

      let destPk: PublicKey;
      try {
        destPk = new PublicKey(destAddress);
      } catch {
        onError('invalid_destination');
        return;
      }

      const lamports = Math.round(amount * LAMPORTS_PER_SOL);
      if (!Number.isFinite(lamports) || lamports <= 0) {
        onError('invalid_amount');
        return;
      }

      let prep;
      try {
        prep = await getBlockhashWithFallback();
      } catch {
        onError('rpc_unavailable');
        return;
      }
      const { connection, blockhash, lastValidBlockHeight } = prep;

      // Pre-flight balance check. Catching insufficient funds here
      // routes to a specific banner with an actionable hint (buy SOL
      // on mainnet, faucet link on devnet) instead of letting Phantom
      // render its "Failed to simulate the results of this request"
      // red banner — which CodeQL-style reputation scrapers and users
      // both read as "this dApp is broken or malicious."
      //
      // Buffer: 80_000 lamports ≈ 0.00008 SOL. Phantom's network-fee
      // display on a SystemTransfer + Memo bundle currently shows
      // exactly that figure, and the previous 5_000-lamport buffer
      // was too tight — a wallet with 6_000 lamports passed our
      // check, then failed simulation inside the wallet popup.
      //
      // The mainnet vs. devnet branch resolves a cluster-mismatch
      // false positive specific to non-prod testing: on devnet/testnet
      // builds it's common for the wallet extension to be pinned to
      // mainnet, so `getBalance(pubkey)` returns 0 from the cluster
      // the user never funded that key on. We keep the `> 0` guard
      // there so the wallet's own clearer "wrong network" message
      // surfaces. On mainnet there's no such ambiguity — a 0 balance
      // is a real 0 balance, and falling through to Phantom would
      // produce the simulation-failure red banner the user just
      // showed us. Treat `balance === 0` as insufficient_balance on
      // mainnet.
      const isMainnet =
        process.env.NEXT_PUBLIC_PAYMENT_NETWORK === 'mainnet';
      const minRequired = lamports + 80_000;
      try {
        const balance = await connection.getBalance(publicKey);
        if (isMainnet ? balance < minRequired : balance > 0 && balance < minRequired) {
          onError('insufficient_balance');
          return;
        }
      } catch {
        // RPC blip on the balance check — don't block; the wallet
        // popup will run its own check and surface any shortfall.
      }

      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = publicKey;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: destPk,
          lamports,
        }),
      );
      tx.add(
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(sessionId, 'utf8'),
        }),
      );

      const signature = await sendTransaction(tx, connection);
      onSent(signature);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(classifyWalletError(msg));
    }
  }, [
    amount,
    connect,
    connected,
    destAddress,
    onError,
    onSent,
    publicKey,
    sendTransaction,
    sessionId,
    wallet,
  ]);

  const ready = connected && !!publicKey && !!wallet;
  const ctaLabel = ready
    ? t('cta.payWithSol', { wallet: wallet.adapter.name })
    : t('cta.connectAndPay');

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="
          group relative inline-flex items-center justify-center gap-2 h-13 px-5 w-full
          rounded-xl text-[14px] font-semibold tracking-tight
          bg-[var(--fg)] text-[var(--bg)] py-3
          transition-[transform,opacity] duration-200 ease-out
          disabled:opacity-40 disabled:cursor-not-allowed
          motion-safe:enabled:hover:-translate-y-[1px]
          enabled:hover:opacity-90
        "
      >
        <span>{ctaLabel}</span>
        <span
          aria-hidden
          className="transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5"
        >
          →
        </span>
      </button>
      <ConnectWalletAlert
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
      />
    </>
  );
}
