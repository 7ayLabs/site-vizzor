/**
 * SectionEyebrow — the small uppercase label that sits above a section title.
 *
 * Builds on the global `.eyebrow` utility (defined in globals.css) and adds
 * exactly one decorative element: a 24×1px accent hairline. For `align='left'`
 * the hairline leads (▬▬ TEXT); for `align='center'` it flanks both sides
 * (▬▬ TEXT ▬▬) so the label sits visually balanced over a centered hero.
 *
 * The hairline is structural (not text) — using ::before/::after pseudo
 * elements via the `data-eyebrow-align` attribute keeps the markup clean.
 */
import { cn } from '@/lib/utils';

export interface SectionEyebrowProps {
  children: React.ReactNode;
  as?: 'p' | 'span' | 'div';
  align?: 'left' | 'center';
}

const HAIRLINE_BASE =
  "before:content-[''] before:inline-block before:h-px before:w-6 before:bg-[var(--accent)] before:align-middle";

const HAIRLINE_TRAILING =
  "after:content-[''] after:inline-block after:h-px after:w-6 after:bg-[var(--accent)] after:align-middle";

export function SectionEyebrow({
  children,
  as: Tag = 'p',
  align = 'left',
}: SectionEyebrowProps) {
  const isCenter = align === 'center';

  return (
    <Tag
      className={cn(
        'eyebrow inline-flex items-center gap-2',
        isCenter && 'justify-center w-full',
        HAIRLINE_BASE,
        isCenter && HAIRLINE_TRAILING,
      )}
    >
      <span>{children}</span>
    </Tag>
  );
}
