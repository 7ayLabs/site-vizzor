/**
 * CtaSecondary — the calmer twin of CtaPrimary.
 *
 * Same prop shape and sizes, but outlined: transparent fill, hairline border
 * that strengthens on hover, plus a faint surface-2 wash. No accent glow —
 * this is the "Read the docs" companion to "Open in Telegram", and it must
 * never compete visually with its primary partner.
 *
 * Deliberately no $ prefix or mono coercion for command-shaped children; the
 * secondary button is for navigation/disclosure, not for terminal verbs.
 */
import type { ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

type LinkHref = ComponentProps<typeof Link>['href'];

export interface CtaSecondaryProps {
  href: string;
  external?: boolean;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<CtaSecondaryProps['size']>, string> = {
  sm: 'h-8 px-3 text-[12px] gap-1',
  md: 'h-10 px-5 text-[13px] gap-1.5',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

export function CtaSecondary({
  href,
  external = false,
  children,
  size = 'md',
  icon,
}: CtaSecondaryProps) {
  const className = cn(
    'group inline-flex items-center justify-center whitespace-nowrap rounded-full',
    'bg-transparent text-[var(--fg)]',
    'border border-[var(--border)]',
    'transition-[background-color,border-color] duration-150 ease-out',
    'hover:bg-[var(--surface-2)] hover:border-[var(--fg)]',
    SIZE_CLASSES[size],
    'font-semibold tracking-tight',
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

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href as LinkHref} className={className}>
      {content}
    </Link>
  );
}
