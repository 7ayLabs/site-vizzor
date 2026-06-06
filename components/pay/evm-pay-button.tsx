'use client';

/**
 * EvmPayButton — Base / Arbitrum USDC payment trigger.
 *
 * Connects to the user's EVM wallet (MetaMask, Rainbow, Coinbase
 * Wallet, Brave Wallet, etc.) via EIP-6963 wallet discovery, requests
 * a chain switch if needed, and submits a `transfer(to, amount)`
 * calldata on the canonical USDC contract. Returns the tx hash via
 * `onSent` so the parent CheckoutShell can transition to the
 * "broadcasting" state and start polling.
 *
 * Why not wagmi / @reown/appkit?
 *
 *   We need exactly one ERC-20 transfer per payment session. wagmi +
 *   @reown/appkit add ~200KB to the client bundle for connection
 *   management we don't need here. EIP-6963 (a 2024-standard wallet
 *   discovery protocol that every modern EVM wallet implements)
 *   gives us the same wallet picker UX with no provider tree and a
 *   ~5KB footprint. viem (~50KB, already a direct dep from the EVM
 *   watcher slice) does the calldata encoding.
 *
 * Per the cybersecurity standard (plan §10.2 EVM):
 *
 *   - Canonical USDC contract pinning. Same Circle-issued addresses
 *     as the EVM watcher; no env override.
 *   - Strict chain-id assertion. After wallet_switchEthereumChain
 *     we re-read eth_chainId and refuse to submit if it doesn't
 *     match the expected chain. Defends against a wallet that
 *     silently ignores the switch request.
 *   - No EIP-2612 permit. Canonical transfer(to, amount) only.
 *   - No EIP-1559 fee override. Wallet's default fee strategy
 *     applies, so the user sees the same gas UI they're used to.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Wallet } from 'lucide-react';
import { encodeFunctionData, parseAbi } from 'viem';

const USDC_ABI = parseAbi([
  'function transfer(address to, uint256 value) returns (bool)',
]);

interface ChainConfig {
  /** EIP-155 numeric chain id. */
  chainId: number;
  /** Hex form for wallet_switchEthereumChain. */
  chainIdHex: `0x${string}`;
  /** Canonical Circle-issued USDC contract. */
  usdc: `0x${string}`;
  /** Display name shown to the user during the chain-switch prompt. */
  displayName: string;
  /** Public RPC URL (the wallet picks; we only need it for
   *  wallet_addEthereumChain if the wallet has never seen the chain). */
  addChainParams: {
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
}

const CHAINS: Record<'base' | 'arbitrum', ChainConfig> = {
  base: {
    chainId: 8453,
    chainIdHex: '0x2105',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    displayName: 'Base',
    addChainParams: {
      chainName: 'Base',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org'],
    },
  },
  arbitrum: {
    chainId: 42161,
    chainIdHex: '0xa4b1',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    displayName: 'Arbitrum One',
    addChainParams: {
      chainName: 'Arbitrum One',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://arb1.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://arbiscan.io'],
    },
  },
};

const USDC_DECIMALS = 6;

interface EvmPayButtonProps {
  destAddress: string;
  /** Amount in human USDC units (e.g. 9.4923). */
  amount: number;
  sessionId: string;
  chain: 'base' | 'arbitrum';
  onSent: (txHash: string) => void;
  onError: (reason: string) => void;
  disabled?: boolean;
}

/**
 * EIP-6963 wallet record as announced by every modern EVM wallet.
 * The provider is the per-wallet EIP-1193 instance — we never touch
 * window.ethereum directly so two wallets installed side by side
 * stay disambiguated.
 */
interface Eip6963Provider {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface AnnounceEvent extends CustomEvent {
  detail: Eip6963Provider;
}

export function EvmPayButton({
  destAddress,
  amount,
  sessionId,
  chain,
  onSent,
  onError,
  disabled = false,
}: EvmPayButtonProps) {
  const t = useTranslations('pay.wallet');
  const cfg = CHAINS[chain];
  const [providers, setProviders] = useState<Eip6963Provider[]>([]);
  const [signing, setSigning] = useState(false);
  const [selectedRdns, setSelectedRdns] = useState<string | null>(null);

  // EIP-6963 wallet discovery — listen for announcements + request
  // re-announce so we capture wallets that loaded before we mounted.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seen = new Set<string>();
    const onAnnounce = (e: Event) => {
      const detail = (e as AnnounceEvent).detail;
      if (!detail?.info?.uuid || seen.has(detail.info.uuid)) return;
      seen.add(detail.info.uuid);
      setProviders((prev) => [...prev, detail]);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () =>
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  const calldata = useMemo(() => {
    if (!destAddress.startsWith('0x') || destAddress.length !== 42) return null;
    try {
      const rawAmount = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
      return encodeFunctionData({
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [destAddress as `0x${string}`, rawAmount],
      });
    } catch {
      return null;
    }
  }, [destAddress, amount]);

  const connected = providers.length > 0;
  // Default to the first announced provider until the user picks one.
  const active =
    providers.find((p) => p.info.rdns === selectedRdns) ?? providers[0] ?? null;

  const onPay = async () => {
    if (!active || !calldata) {
      onError('no_wallet');
      return;
    }
    setSigning(true);
    try {
      // 1. Request accounts (also surfaces the wallet popup if locked).
      const accounts = (await active.provider.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const from = accounts[0];
      if (!from) throw new Error('no_account');

      // 2. Ensure the wallet is on the right chain. wallet_switchEthereumChain
      //    throws 4902 if the chain is unknown to the wallet — we then add
      //    it and retry the switch.
      const currentChainHex = (await active.provider.request({
        method: 'eth_chainId',
      })) as `0x${string}`;
      if (currentChainHex.toLowerCase() !== cfg.chainIdHex.toLowerCase()) {
        try {
          await active.provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: cfg.chainIdHex }],
          });
        } catch (switchErr) {
          const code = (switchErr as { code?: number })?.code;
          if (code === 4902) {
            await active.provider.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: cfg.chainIdHex,
                  ...cfg.addChainParams,
                },
              ],
            });
            await active.provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: cfg.chainIdHex }],
            });
          } else {
            throw switchErr;
          }
        }
        // Strict chain-id assertion after the switch — defends against
        // wallets that silently ignore the switch (plan §10.2 EVM).
        const afterSwitch = (await active.provider.request({
          method: 'eth_chainId',
        })) as `0x${string}`;
        if (afterSwitch.toLowerCase() !== cfg.chainIdHex.toLowerCase()) {
          throw new Error('chain_switch_refused');
        }
      }

      // 3. Submit the transfer. We let the wallet pick the fee strategy.
      const txHash = (await active.provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from,
            to: cfg.usdc,
            data: calldata,
            value: '0x0',
          },
        ],
      })) as string;

      onSent(txHash);
    } catch (e) {
      const code = (e as { code?: number })?.code;
      if (code === 4001) {
        onError('wallet_rejected');
      } else {
        onError(stringifyError(e));
      }
    } finally {
      setSigning(false);
    }
  };

  const label = !connected
    ? t('connect')
    : signing
      ? t('signing')
      : t('payNowUsdc', { amount: amount.toFixed(2), chain: cfg.displayName });

  if (!connected) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled
          className="
            inline-flex items-center justify-center gap-2 h-12 px-5 w-full
            text-[13px] font-semibold tracking-tight
            bg-[var(--surface-2)] text-[var(--fg-3)]
            cursor-not-allowed
          "
        >
          <Wallet size={14} strokeWidth={2} />
          <span>{t('noEvmWallet')}</span>
        </button>
        <p className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {t('noEvmWalletHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.length > 1 && (
        <ul
          role="radiogroup"
          aria-label={t('walletPicker')}
          className="grid grid-cols-2 gap-2"
        >
          {providers.map((p) => {
            const isActive = active?.info.uuid === p.info.uuid;
            return (
              <li key={p.info.uuid}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setSelectedRdns(p.info.rdns)}
                  className={`w-full flex items-center gap-2 border px-2.5 py-2 text-left text-[12px] ${
                    isActive
                      ? 'border-[var(--accent)] bg-[var(--surface)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.info.icon}
                    alt=""
                    width={16}
                    height={16}
                    className="h-4 w-4"
                  />
                  <span className="truncate text-[var(--fg)]">
                    {p.info.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={onPay}
        disabled={disabled || signing || !calldata}
        data-session-id={sessionId}
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
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 160);
  return String(e).slice(0, 160);
}
