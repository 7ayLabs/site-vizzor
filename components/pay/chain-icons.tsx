/**
 * Official-mark SVG components for each supported payment chain.
 *
 * Inlined as React components (vs static SVG files) so the icons
 * inherit `currentColor` where appropriate, render crisp at any size,
 * and don't add a network round-trip on first paint. The paths come
 * from each project's public brand kit:
 *   - Solana:   solana.com/branding
 *   - TON:      ton.org/brand-assets
 *   - USDC:     centre.io/brand (Circle)
 *   - Base:     base.org/brand
 *   - Arbitrum: arbitrum.io/brand
 */

import type { SVGProps } from 'react';

export type ChainIconId =
  | 'solana'
  | 'ton'
  | 'usdc'
  | 'base'
  | 'arbitrum';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export function SolanaIcon({ size = 28, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 397.7 311.7"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <defs>
        <linearGradient
          id="solana-grad-1"
          x1="360.879"
          y1="351.455"
          x2="141.213"
          y2="-69.294"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient
          id="solana-grad-2"
          x1="264.829"
          y1="401.601"
          x2="45.163"
          y2="-19.148"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient
          id="solana-grad-3"
          x1="312.548"
          y1="376.688"
          x2="92.882"
          y2="-44.061"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path
        d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
        fill="url(#solana-grad-1)"
      />
      <path
        d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
        fill="url(#solana-grad-2)"
      />
      <path
        d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.6z"
        fill="url(#solana-grad-3)"
      />
    </svg>
  );
}

export function TonIcon({ size = 28, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <circle cx="28" cy="28" r="28" fill="#0098EA" />
      <path
        d="M37.56 15.6H18.44c-3.51 0-5.74 3.79-3.98 6.85L26.27 42.6c.77 1.32 2.69 1.32 3.46 0l11.82-20.15c1.76-3.06-.46-6.85-3.99-6.85zM26.26 36.42L23.69 31.4l-6.2-11.21c-.41-.71.1-1.62.94-1.62h7.83v17.84zm12.04-17.24l-6.2 11.22-2.57 5.02V18.57h7.83c.84 0 1.34.91.94 1.62z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function UsdcIcon({ size = 28, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path
        d="M20.5 18.5c0-2.4-1.4-3.2-4.3-3.55-2.05-.27-2.45-.82-2.45-1.78s.7-1.6 2.05-1.6c1.22 0 1.93.41 2.28 1.43.07.21.28.34.49.34h1.1c.28 0 .49-.21.49-.49v-.07c-.28-1.51-1.51-2.66-3.08-2.8V8.4c0-.28-.21-.49-.55-.55h-1.04c-.28 0-.49.21-.55.55v1.51c-2.05.27-3.35 1.64-3.35 3.35 0 2.26 1.37 3.14 4.27 3.49 1.92.34 2.5.75 2.5 1.85s-.95 1.85-2.26 1.85c-1.78 0-2.4-.75-2.6-1.78-.07-.27-.28-.41-.49-.41h-1.17c-.28 0-.49.21-.49.49v.07c.28 1.71 1.37 2.94 3.62 3.28v1.58c0 .28.21.49.55.55h1.04c.28 0 .49-.21.55-.55V21.5c2.05-.34 3.42-1.78 3.42-3.49z"
        fill="#FFFFFF"
      />
      <path
        d="M12.6 25.5c-5.3-1.92-8.04-7.82-6.04-13.05 1.04-2.94 3.35-5.18 6.04-6.22.28-.14.41-.34.41-.69V4.5c0-.27-.14-.48-.41-.55-.07 0-.21 0-.28.07-6.45 2.05-9.99 8.91-7.93 15.36 1.23 3.83 4.18 6.79 7.93 8.02.28.14.55-.07.55-.34v-1.04c0-.21-.14-.41-.27-.55zm6.94-21.48c-.28-.14-.55.07-.55.34v1.04c0 .27.14.48.27.62 5.3 1.92 8.04 7.82 6.04 13.05-1.03 2.94-3.35 5.18-6.04 6.22-.27.14-.41.34-.41.69v1.04c0 .27.14.48.41.55.07 0 .21 0 .28-.07 6.45-2.05 9.99-8.91 7.93-15.36-1.23-3.9-4.25-6.86-7.93-8.12z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function BaseIcon({ size = 28, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 111 111"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <path
        d="M54.921 110.034c30.438 0 55.113-24.659 55.113-55.078C110.034 24.537 85.359 0 54.921 0 26.041 0 2.354 22.052 0 50.32h72.847v9.428H0c2.354 28.27 26.041 50.286 54.921 50.286z"
        fill="#0052FF"
      />
    </svg>
  );
}

export function ArbitrumIcon({ size = 28, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 470 514"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <path
        d="M0 130v257l235 127 235-127V130L235 4 0 130z"
        fill="#213147"
      />
      <path
        d="M280 295l-30 80c-1 2-1 5 0 8l52 142 60-33-72-197c-2-5-9-5-10 0z"
        fill="#12AAFF"
      />
      <path
        d="M339 156c-2-5-9-5-11 0L97 800l59 34L350 268c1-2 1-4 0-6l-11-106z"
        fill="#12AAFF"
        transform="translate(0,-540) scale(1)"
      />
      <path
        d="M235 38l199 115v228L235 496 36 381V153L235 38zm0-38L0 132v250l235 130 235-130V132L235 0z"
        fill="#9DCCED"
      />
      <path
        d="M158 469l-22-12 217-378 23 13"
        fill="#FFFFFF"
      />
      <path
        d="M283 153h-58l-191 332 41 23 19-31 7-12 50-87 80-138 12-22 40 5z"
        fill="#FFFFFF"
      />
      <path
        d="M283 153l-37 64 47 116 78 14-12-69-76-125zM304 410l-33-90-9 13 32 90z"
        fill="#28A0F0"
      />
      <path
        d="M0 380l36 21V133L0 154v226z"
        fill="#28A0F0"
      />
    </svg>
  );
}

/** Lookup helper — returns the icon component for a given chain id. */
export function ChainIcon({
  id,
  size = 28,
}: {
  id: ChainIconId;
  size?: number;
}) {
  const Comp =
    id === 'solana'
      ? SolanaIcon
      : id === 'ton'
        ? TonIcon
        : id === 'base'
          ? BaseIcon
          : id === 'arbitrum'
            ? ArbitrumIcon
            : UsdcIcon;
  return <Comp size={size} />;
}
