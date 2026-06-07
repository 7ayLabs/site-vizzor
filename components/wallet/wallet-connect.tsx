'use client';

/**
 * ConnectButton — Vizzor-styled wrapper around the Solana wallet adapter.
 *
 * Two visual states:
 *   - Disconnected → "Connect wallet" pill, click opens the upstream
 *     wallet-adapter modal (Phantom / Solflare / etc.)
 *   - Connected → shows the short address; click disconnects.
 *
 * Styling matches the rest of the site: mono uppercase, hairline border,
 * sharp corners, accent on the active state.
 */

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useTranslations } from 'next-intl';

export function ConnectButton() {
  const t = useTranslations('predict.wallet');
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (publicKey) {
    const addr = publicKey.toBase58();
    const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
    return (
      <button
        type="button"
        onClick={() => void disconnect()}
        className="
          mono tabular text-[10.5px] uppercase tracking-[0.14em]
          border border-[var(--border)] bg-[var(--surface-2)]
          px-3 py-2 text-[var(--fg)]
          hover:bg-[var(--surface)] transition-colors
        "
      >
        {short} · {t('disconnect')}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setVisible(true)}
      disabled={connecting}
      className="
        mono tabular text-[10.5px] uppercase tracking-[0.14em]
        border border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]
        px-3 py-2 hover:opacity-90 transition-opacity
        disabled:opacity-50 disabled:cursor-not-allowed
      "
    >
      {connecting ? t('connecting') : t('connect')}
    </button>
  );
}
