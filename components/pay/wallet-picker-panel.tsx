'use client';

/**
 * WalletPickerPanel — Solana wallet detection / connection / status.
 *
 * Two modes share one component:
 *   1. PICK mode (no wallet connected) — lists every Wallet-Standard
 *      adapter discovered in the browser. Each row shows the adapter's
 *      official icon, name, and ready-state. Clicking a "Ready" row
 *      calls `select(name)` + `connect()`, opening THAT extension's
 *      approval popup. Rows that aren't installed link to the wallet's
 *      official download page.
 *   2. STATUS mode (wallet connected) — collapses to a single compact
 *      pill showing the active wallet, its short address, and a
 *      Disconnect action. Keeps the page calm once the user is ready
 *      to sign — the Pay button below is the only remaining action.
 *
 * Filtering: EVM-only Standard wallets (MetaMask, Rabby, Trust,
 * WalletConnect) are excluded. They register via Wallet Standard but
 * can't sign Solana transactions — listing them would be a dead end.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState, type Adapter } from '@solana/wallet-adapter-base';
import { Check, ExternalLink, LogOut, Wallet2 } from 'lucide-react';
import Image from 'next/image';

const NON_SOLANA_WALLETS: ReadonlySet<string> = new Set([
  'MetaMask',
  'Rabby Wallet',
  'Rabby',
  'Trust',
  'Trust Wallet',
  'WalletConnect',
]);

const INSTALL_URLS: Record<string, string> = {
  Phantom: 'https://phantom.app/download',
  Solflare: 'https://solflare.com/download',
  Backpack: 'https://backpack.app/downloads',
  Glow: 'https://glow.app/download',
};

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

interface WalletPickerPanelProps {
  /** Called once the wallet is selected and connected — UI can dismiss. */
  onReady?: () => void;
}

export function WalletPickerPanel({ onReady }: WalletPickerPanelProps) {
  const t = useTranslations('pay.walletPicker');
  const {
    wallets,
    select,
    wallet,
    connect,
    connected,
    connecting,
    disconnect,
    publicKey,
  } = useWallet();

  const sortedWallets = useMemo(() => {
    const order: Record<WalletReadyState, number> = {
      [WalletReadyState.Installed]: 0,
      [WalletReadyState.Loadable]: 1,
      [WalletReadyState.NotDetected]: 2,
      [WalletReadyState.Unsupported]: 3,
    };
    return wallets
      .filter((w) => !NON_SOLANA_WALLETS.has(w.adapter.name))
      .sort((a, b) => {
        const ra = order[a.readyState] ?? 99;
        const rb = order[b.readyState] ?? 99;
        if (ra !== rb) return ra - rb;
        return a.adapter.name.localeCompare(b.adapter.name);
      });
  }, [wallets]);

  const installedCount = sortedWallets.filter(
    (w) =>
      w.readyState === WalletReadyState.Installed ||
      w.readyState === WalletReadyState.Loadable,
  ).length;

  const handlePick = async (adapter: Adapter) => {
    const ready =
      adapter.readyState === WalletReadyState.Installed ||
      adapter.readyState === WalletReadyState.Loadable;
    if (!ready) return;
    try {
      select(adapter.name);
      await new Promise((r) => setTimeout(r, 50));
      await connect().catch(() => {});
      onReady?.();
    } catch {
      // The connect flow surfaces its own error; nothing to do here.
    }
  };

  // STATUS mode — wallet connected. Compact pill + disconnect.
  if (connected && wallet && publicKey) {
    return (
      <section
        id="wallet-picker-panel"
        aria-label={t('label')}
        className="
          rounded-xl border border-[var(--border)] bg-[var(--surface)]
          flex items-center gap-3 p-3 scroll-mt-24
        "
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-2)]"
        >
          {wallet.adapter.icon ? (
            <Image
              src={wallet.adapter.icon}
              alt={wallet.adapter.name}
              width={32}
              height={32}
              unoptimized
            />
          ) : (
            <Wallet2 size={16} strokeWidth={2} />
          )}
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[13px] font-semibold text-[var(--fg)] truncate">
            {wallet.adapter.name}
          </span>
          <span className="mono tabular text-[10.5px] text-[var(--fg-3)] truncate">
            {truncateAddress(publicKey.toBase58())}
          </span>
        </span>
        <span
          aria-hidden
          className="mono tabular text-[9.5px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-md bg-[color:color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)] inline-flex items-center gap-1"
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] motion-safe:animate-[pulse-dot_1.6s_ease-in-out_infinite]"
            aria-hidden
          />
          {t('connected')}
        </span>
        <button
          type="button"
          onClick={() => void disconnect().catch(() => {})}
          aria-label={t('disconnect')}
          title={t('disconnect')}
          className="
            inline-flex h-8 w-8 items-center justify-center rounded-lg
            text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
            transition-colors
          "
        >
          <LogOut size={14} strokeWidth={2} />
        </button>
      </section>
    );
  }

  // PICK mode.
  return (
    <section
      id="wallet-picker-panel"
      aria-labelledby="wallet-picker-title"
      className="
        rounded-xl border border-[var(--border)] bg-[var(--surface)]
        flex flex-col gap-3 p-4 scroll-mt-24
      "
    >
      <header className="flex items-center justify-between">
        <p
          id="wallet-picker-title"
          className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)] inline-flex items-center gap-2"
        >
          <Wallet2 size={12} strokeWidth={2.2} />
          <span>{t('label')}</span>
        </p>
        <span
          className={`
            mono tabular text-[9.5px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-md
            ${
              installedCount > 0
                ? 'bg-[color:color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]'
                : 'border border-[var(--border)] text-[var(--fg-3)]'
            }
          `}
        >
          {installedCount > 0
            ? t('detected', { n: installedCount })
            : t('none')}
        </span>
      </header>

      {sortedWallets.length === 0 ? (
        <EmptyHint />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sortedWallets.map(({ adapter, readyState }) => {
            const ready =
              readyState === WalletReadyState.Installed ||
              readyState === WalletReadyState.Loadable;
            const isSelected = wallet?.adapter.name === adapter.name;
            const isBusy = isSelected && connecting;
            return (
              <li key={adapter.name}>
                <button
                  type="button"
                  onClick={() => handlePick(adapter)}
                  disabled={!ready}
                  className={`
                    group/walletrow w-full flex items-center gap-3
                    px-3 py-2.5 rounded-lg
                    border transition-[transform,border-color,background-color] duration-200 ease-out
                    ${
                      isSelected
                        ? 'border-[var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_8%,var(--surface))]'
                        : ready
                          ? 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] motion-safe:hover:-translate-y-[1px]'
                          : 'border-[var(--border)] bg-transparent opacity-55 cursor-not-allowed'
                    }
                  `}
                >
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--surface-2)]"
                  >
                    {adapter.icon ? (
                      <Image
                        src={adapter.icon}
                        alt={adapter.name}
                        width={32}
                        height={32}
                        unoptimized
                      />
                    ) : (
                      <Wallet2 size={14} strokeWidth={2} />
                    )}
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col text-left">
                    <span className="text-[13px] font-semibold text-[var(--fg)] truncate">
                      {adapter.name}
                    </span>
                    <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)] truncate">
                      {isBusy
                        ? t('connecting')
                        : ready
                          ? t('installed')
                          : t('notInstalled')}
                    </span>
                  </span>
                  {ready ? (
                    isSelected ? (
                      <Check
                        size={14}
                        strokeWidth={2.5}
                        className="text-[var(--accent)]"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)] transition-colors group-hover/walletrow:text-[var(--accent)]"
                      >
                        {t('connect')}
                      </span>
                    )
                  ) : (
                    <a
                      href={INSTALL_URLS[adapter.name] ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="
                        inline-flex items-center gap-1
                        mono tabular text-[10px] uppercase tracking-[0.14em]
                        text-[var(--fg-3)] hover:text-[var(--fg)]
                      "
                    >
                      <span>{t('install')}</span>
                      <ExternalLink size={11} strokeWidth={2} />
                    </a>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)] leading-relaxed">
        {t('footer')}
      </p>
    </section>
  );
}

function EmptyHint() {
  const t = useTranslations('pay.walletPicker');
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-center">
      <p className="text-[12px] text-[var(--fg-2)]">{t('emptyTitle')}</p>
      <p className="mt-1 mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
        {t('emptyHint')}
      </p>
    </div>
  );
}
