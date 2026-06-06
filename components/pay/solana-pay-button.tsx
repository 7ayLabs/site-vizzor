'use client';

/**
 * SolanaPayButton — initiates a native SOL transfer from the connected
 * wallet (via the Solana Wallet Adapter) to the session's destination
 * address. Attaches a memo carrying the session_id so the watcher can
 * demux confirmations.
 *
 * The button only signs & sends — confirmation is the watcher's job.
 * On signature, we hand the txSig up to CheckoutShell which transitions
 * the state machine to `paying` and starts polling.
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

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

function rpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
  );
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

  const handleClick = useCallback(async () => {
    try {
      if (!connected) {
        if (!wallet) {
          onError('no_wallet_selected');
          return;
        }
        await connect();
      }
      if (!publicKey) {
        onError('wallet_not_connected');
        return;
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

      const connection = new Connection(rpcUrl(), 'confirmed');

      const tx = new Transaction();
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
      onError(msg.slice(0, 200));
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

  return (
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
      <span>
        {connected ? t('cta.payWithSol') : t('cta.connectAndPay')}
      </span>
      <span
        aria-hidden
        className="transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5"
      >
        →
      </span>
    </button>
  );
}
