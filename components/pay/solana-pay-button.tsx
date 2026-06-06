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
  const network =
    process.env.NEXT_PUBLIC_PAYMENT_NETWORK === 'mainnet'
      ? 'mainnet'
      : process.env.NEXT_PUBLIC_PAYMENT_NETWORK === 'testnet'
        ? 'testnet'
        : process.env.NODE_ENV === 'production'
          ? 'mainnet'
          : 'testnet';

  const configured =
    network === 'mainnet'
      ? (process.env.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET ??
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL)
      : (process.env.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET ??
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL);

  const fallbacks =
    network === 'mainnet'
      ? ['https://solana-rpc.publicnode.com', 'https://rpc.ankr.com/solana']
      : ['https://api.devnet.solana.com'];

  return configured ? [configured, ...fallbacks] : fallbacks;
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
      onError(
        /rejected|user denied|user rejected/i.test(msg)
          ? 'wallet_rejected'
          : msg.slice(0, 200),
      );
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
          group relative inline-flex items-center justify-center gap-2 h-12 px-5 w-full
          rounded-xl text-[13px] font-semibold tracking-tight
          bg-[var(--accent)] text-[var(--accent-fg)]
          transition-[transform,opacity,box-shadow] duration-200 ease-out
          shadow-[0_8px_28px_-12px_color-mix(in_oklab,var(--accent)_60%,transparent)]
          disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
          motion-safe:enabled:hover:-translate-y-[1px]
          motion-safe:enabled:hover:shadow-[0_12px_30px_-12px_color-mix(in_oklab,var(--accent)_70%,transparent)]
          enabled:hover:opacity-95
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
