'use client';

/**
 * BurnButton — builds and submits the SPL token burn transaction.
 *
 * Flow on click:
 *   1. Resolve the user's $VIZZOR ATA and the incinerator's ATA.
 *   2. Fetch mint decimals (one RPC call per click; not worth caching).
 *   3. Build a `transferChecked` instruction sending `burnAmount()`
 *      tokens to the incinerator.
 *   4. Send via the connected wallet, wait for confirmation.
 *   5. Call `onConfirmed(signature)` so the parent can attach the sig
 *      as an `x-vizzor-burn-tx` header on the next chat request.
 *
 * If the mint isn't configured (pre-launch), the button is disabled
 * with a "mint not configured" tooltip. The server-side feature flag
 * is the ultimate gate; this button just guides the UX.
 */

import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { useTranslations } from 'next-intl';
import { INCINERATOR_ADDRESS, burnAmount, vizzorMint } from '@/lib/solana';

interface BurnButtonProps {
  onConfirmed: (signature: string) => void;
}

export function BurnButton({ onConfirmed }: BurnButtonProps) {
  const t = useTranslations('predict.wallet');
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mint = vizzorMint();
  const amount = burnAmount();
  const disabled = !publicKey || !mint || busy;

  const onClick = async () => {
    if (!publicKey || !mint) return;
    setBusy(true);
    setError(null);
    try {
      const mintPk = new PublicKey(mint);
      const incinerator = new PublicKey(INCINERATOR_ADDRESS);

      const sourceAta = getAssociatedTokenAddressSync(mintPk, publicKey);
      // `allowOwnerOffCurve=true` because the incinerator is a vanity
      // address that doesn't sit on the ed25519 curve.
      const destAta = getAssociatedTokenAddressSync(
        mintPk,
        incinerator,
        true,
      );

      const mintInfo = await connection.getParsedAccountInfo(mintPk);
      const decimals = readMintDecimals(mintInfo.value?.data);
      const rawAmount = BigInt(Math.floor(amount * 10 ** decimals));

      const ix = createTransferCheckedInstruction(
        sourceAta,
        mintPk,
        destAta,
        publicKey,
        rawAmount,
        decimals,
      );

      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection);
      // Wait for at least 'confirmed' so the server-side
      // getParsedTransaction sees it immediately.
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      onConfirmed(sig);
    } catch (e) {
      setError(parseWalletError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="
          mono tabular text-[10.5px] uppercase tracking-[0.14em]
          border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]
          px-3 py-2 hover:opacity-90 transition-opacity
          disabled:opacity-40 disabled:cursor-not-allowed
        "
      >
        {busy
          ? t('burning')
          : t('burnCta', { amount: String(amount) })}
      </button>

      {!mint && (
        <p className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {t('mintNotConfigured')}
        </p>
      )}
      {error && (
        <p className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
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
  // Safe default for SPL tokens — most use 9 like SOL itself.
  return 9;
}

function parseWalletError(e: unknown): string {
  if (e instanceof Error) {
    // Wallet adapters frequently throw with messages prefixed by
    // "WalletSendTransactionError:" — surface the underlying line.
    const msg = e.message.split(':').slice(-1)[0]?.trim() ?? e.message;
    return msg.slice(0, 80);
  }
  return 'Unknown error';
}
