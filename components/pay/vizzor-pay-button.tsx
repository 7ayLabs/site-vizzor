'use client';

/**
 * VizzorPayButton — builds and submits the SPL $VIZZOR transfer.
 *
 * Mirrors `components/wallet/burn-button.tsx` (proven on /predict) but
 * sends to the engine-derived treasury ATA (`session.destAddress`)
 * instead of the burn incinerator, and includes a Memo program
 * instruction carrying `session.sessionId` so the watcher daemon can
 * disambiguate inbound payments at the shared treasury account.
 *
 * Reuses the Solana wallet adapter chunk already loaded for /predict —
 * adding this button doesn't ship a single new dependency.
 */

import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { useTranslations } from 'next-intl';
import { Wallet } from 'lucide-react';
import { vizzorMint } from '@/lib/solana';

// Memo program — well-known address. Used to attach the session id to
// the tx so the watcher can disambiguate at a shared treasury ATA.
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

interface VizzorPayButtonProps {
  destAddress: string;
  amount: number;
  sessionId: string;
  onSent: (signature: string) => void;
  onError: (reason: string) => void;
  disabled?: boolean;
}

export function VizzorPayButton({
  destAddress,
  amount,
  sessionId,
  onSent,
  onError,
  disabled = false,
}: VizzorPayButtonProps) {
  const t = useTranslations('pay.wallet');
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [busy, setBusy] = useState(false);

  const mint = vizzorMint();
  const connected = Boolean(publicKey);

  const onClick = async () => {
    if (!publicKey || !mint) {
      onError(!mint ? 'mint_not_configured' : 'wallet_not_connected');
      return;
    }
    setBusy(true);
    try {
      const mintPk = new PublicKey(mint);
      const destOwner = new PublicKey(destAddress);

      const sourceAta = getAssociatedTokenAddressSync(mintPk, publicKey);
      // `allowOwnerOffCurve=true` in case the engine derives the
      // treasury under a PDA. Safe default for any owner address.
      const destAta = getAssociatedTokenAddressSync(mintPk, destOwner, true);

      const mintInfo = await connection.getParsedAccountInfo(mintPk);
      const decimals = readMintDecimals(mintInfo.value?.data);
      const rawAmount = BigInt(Math.floor(amount * 10 ** decimals));

      const transferIx = createTransferCheckedInstruction(
        sourceAta,
        mintPk,
        destAta,
        publicKey,
        rawAmount,
        decimals,
      );

      const memoIx = new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM,
        data: Buffer.from(sessionId, 'utf8'),
      });

      const tx = new Transaction().add(transferIx).add(memoIx);
      const sig = await sendTransaction(tx, connection);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      onSent(sig);
    } catch (e) {
      onError(parseWalletError(e));
    } finally {
      setBusy(false);
    }
  };

  const label = !connected
    ? t('connect')
    : busy
      ? t('signing')
      : t('payNowVizzor', { amount: amount.toFixed(2) });

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy || !mint}
      className="
        inline-flex items-center justify-center gap-2 h-12 px-5 w-full
        text-[13px] font-semibold tracking-tight
        bg-[var(--accent)] text-[var(--accent-fg)]
        disabled:opacity-40 disabled:cursor-not-allowed
        hover:opacity-90 transition-opacity
      "
    >
      <Wallet size={14} strokeWidth={2} />
      <span>{label}</span>
      <span aria-hidden>→</span>
    </button>
  );
}

function readMintDecimals(data: unknown): number {
  if (
    data &&
    typeof data === 'object' &&
    'parsed' in data &&
    typeof (data as { parsed: unknown }).parsed === 'object'
  ) {
    const parsed = (data as { parsed: { info?: { decimals?: number } } })
      .parsed;
    if (typeof parsed.info?.decimals === 'number') return parsed.info.decimals;
  }
  return 9;
}

function parseWalletError(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message.split(':').slice(-1)[0]?.trim() ?? e.message;
    return msg.slice(0, 160);
  }
  return 'unknown_error';
}
