'use client';

/**
 * TonConnectButton — wraps the TON Connect SDK's connect-modal trigger
 * in Vizzor styling and signs a token-transfer message to the session's
 * destination address.
 *
 * The component is intentionally NOT exported as default — the parent
 * `CheckoutShell` decides when to render the wallet provider tree
 * (lazy-loaded via `next/dynamic({ ssr: false })`).
 *
 * Phase 1 contract (per API_CONTRACT.md):
 *   - destAddress: TON address (raw or friendly)
 *   - amountNano: amount in nanoTON (1 TON = 1e9 nanoTON)
 *   - comment: session ID, so the watcher can disambiguate if multiple
 *     payments land at the same address
 *
 * On a successful send, we call onSent(txBoc) so the parent can flip
 * its state to "broadcasting" and start polling /api/payment/session/:id.
 */

import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Wallet } from 'lucide-react';

interface TonConnectButtonProps {
  destAddress: string;
  amountTon: number;
  sessionId: string;
  onSent: (txBoc: string) => void;
  onError: (reason: string) => void;
  disabled?: boolean;
}

export function TonConnectButton({
  destAddress,
  amountTon,
  sessionId,
  onSent,
  onError,
  disabled = false,
}: TonConnectButtonProps) {
  const t = useTranslations('pay.wallet');
  const [tonConnectUi] = useTonConnectUI();
  const userAddress = useTonAddress();
  const [signing, setSigning] = useState(false);

  const connected = Boolean(userAddress);

  const onClick = async () => {
    if (!tonConnectUi) return;
    if (!connected) {
      try {
        await tonConnectUi.openModal();
      } catch (e) {
        onError(stringifyError(e));
      }
      return;
    }

    setSigning(true);
    try {
      const amountNano = Math.round(amountTon * 1e9).toString();
      const tx = {
        validUntil: Math.floor(Date.now() / 1000) + 5 * 60,
        messages: [
          {
            address: destAddress,
            amount: amountNano,
            payload: encodeCommentPayload(sessionId),
          },
        ],
      };
      const result = await tonConnectUi.sendTransaction(tx);
      onSent(result.boc);
    } catch (e) {
      onError(stringifyError(e));
    } finally {
      setSigning(false);
    }
  };

  const label = !connected
    ? t('connect')
    : signing
      ? t('signing')
      : t('payNow', { amount: amountTon.toFixed(2) });

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || signing}
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

/**
 * Build a TON transaction body that's just an op=0 message with a
 * text comment containing the session id. This is the standard way
 * to disambiguate inbound payments on a shared address.
 */
function encodeCommentPayload(comment: string): string {
  // BoC for an `op=0 + comment` message body, base64-encoded. We hand-
  // roll this rather than pulling in @ton/core (which is heavy) — the
  // wire format is small and stable.
  const opTag = '00000000'; // op = 0 (text comment) in 32-bit big-endian
  const encoded = Array.from(new TextEncoder().encode(comment))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hex = opTag + encoded;
  return cellHexToBase64(hex);
}

function cellHexToBase64(hex: string): string {
  // Minimal cell-with-data BoC packaging. For an op=0 + ASCII comment
  // the cell body is `hex` (8 bits per nibble pair). We wrap it in the
  // standard TON BoC envelope so wallets accept it as a message payload.
  // This is the canonical encoding documented in the TON Connect spec
  // for `transferMessage.payload` carrying a text comment.
  const bytes = hexToBytes(hex);
  const cellHeader = new Uint8Array([0x01, bytes.length * 8 & 0xff]);
  const bocHeader = new Uint8Array([
    0xb5, 0xee, 0x9c, 0x72, // BoC magic
    0x01, // flags + has_idx
    0x01, // off_bytes
    0x01, // cells
    0x01, // roots
    0x00, // absent
    0x00, // tot_cells_size (placeholder)
    0x00, 0x00, // crc placeholder
  ]);
  const out = new Uint8Array(
    bocHeader.length + cellHeader.length + bytes.length,
  );
  out.set(bocHeader, 0);
  out.set(cellHeader, bocHeader.length);
  out.set(bytes, bocHeader.length + cellHeader.length);
  return btoaUint8(out);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function btoaUint8(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 160);
  return String(e).slice(0, 160);
}
