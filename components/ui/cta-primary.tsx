/**
 * CtaPrimary — the solid emerald action.
 *
 * The most-clicked element on the site. Generalizes the "Open in Telegram"
 * pattern from `components/layout/header.tsx` so we have one place to tune
 * the hover/active feel (scale + accent glow, no bounce, no jitter).
 *
 * Heuristic: if the children read like a shell command (`npm`, `pnpm`, or `$`),
 * we render in mono so the label feels like terminal copy. Everything else
 * stays in the semibold sans body voice.
 *
 * `external` swaps to a native `<a target="_blank">`; otherwise we let
 * Next.js `<Link>` handle client-side routing.
 *
 * `magnetic` (terminal upgrade): when true AND not reduced motion, the
 * button gently tracks the cursor within an 80px radius (up to 8px of
 * translation) via rAF, springing back on mouseleave. When false or
 * reduced motion, behavior is identical to today — no listeners attached,
 * no client JS shipped beyond the base markup. Magnetic mode requires a
 * client wrapper, so we split the rendering paths.
 */
import type { ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { MagneticWrap } from './cta-primary.magnetic';

type LinkHref = ComponentProps<typeof Link>['href'];

export interface CtaPrimaryProps {
  href: string;
  external?: boolean;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  /**
   * When true, the button tracks the cursor within 80px (max 8px lift),
   * springing back on leave. Reduced-motion users get the static button.
   * Defaults to false to preserve current behavior for every existing
   * call site.
   */
  magnetic?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<CtaPrimaryProps['size']>, string> = {
  sm: 'h-8 px-3 text-[12px] gap-1',
  md: 'h-10 px-5 text-[13px] gap-1.5',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

const COMMAND_HINT = /\b(npm|pnpm)\b|\$/;

function looksLikeCommand(node: React.ReactNode): boolean {
  if (typeof node === 'string') return COMMAND_HINT.test(node);
  if (typeof node === 'number') return false;
  if (Array.isArray(node)) return node.some(looksLikeCommand);
  return false;
}

export function CtaPrimary({
  href,
  external = false,
  children,
  size = 'md',
  icon,
  magnetic = false,
}: CtaPrimaryProps) {
  const isCommand = looksLikeCommand(children);

  const className = cn(
    'group inline-flex items-center justify-center whitespace-nowrap rounded-full',
    'bg-[var(--accent)] text-[var(--accent-fg)]',
    'transition-[transform,box-shadow] duration-150 ease-out',
    'hover:scale-[1.02] hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_20%,transparent)]',
    'active:scale-[0.99]',
    SIZE_CLASSES[size],
    isCommand ? 'mono font-medium tracking-tight' : 'font-semibold tracking-tight',
  );

  const content = (
    <>
      <span>{children}</span>
      {icon !== undefined ? (
        <span aria-hidden className="inline-flex items-center">
          {icon}
        </span>
      ) : (
        <span aria-hidden>→</span>
      )}
    </>
  );

  const inner = external ? (
    <a href={href} target="_blank" rel="noopener" className={className}>
      {content}
    </a>
  ) : (
    <Link href={href as LinkHref} className={className}>
      {content}
    </Link>
  );

  if (magnetic) {
    return <MagneticWrap>{inner}</MagneticWrap>;
  }
  return inner;
}
