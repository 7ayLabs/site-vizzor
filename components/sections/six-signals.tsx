/**
 * SixSignals — quieter 6-family grid.
 *
 * Ollama restraint applied to the previous grid: no per-cell borders, no
 * accent icons, no hover-reveal lines. Cells are linked tiles separated by
 * hairline dividers via the `gap-px + bg-border` trick — a single visual
 * mesh rather than six floating cards. Family name is mono, the standard
 * weight reads inline as a small `· 30%` suffix in fg-3.
 *
 * Server component — Lucide icons are tree-shaken at build time.
 */
import type { ComponentProps } from 'react';
import { getTranslations } from 'next-intl/server';
import {
  Activity,
  Brain,
  Scale,
  Newspaper,
  LineChart,
  GitBranch,
  type LucideIcon,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import type { SignalFamily } from '@/lib/types';

type LinkHref = ComponentProps<typeof Link>['href'];

interface FamilySpec {
  family: SignalFamily;
  weight: string;
  icon: LucideIcon;
}

const FAMILIES: ReadonlyArray<FamilySpec> = [
  { family: 'onChain', weight: '30%', icon: Activity },
  { family: 'mlEnsemble', weight: '20%', icon: Brain },
  { family: 'predictionMarkets', weight: '15%', icon: Scale },
  { family: 'socialNarrative', weight: '15%', icon: Newspaper },
  { family: 'patternMatch', weight: '10%', icon: LineChart },
  { family: 'logicRules', weight: '10%', icon: GitBranch },
];

interface FamilyCellProps {
  spec: FamilySpec;
  description: string;
  ariaLabel: string;
}

function FamilyCell({ spec, description, ariaLabel }: FamilyCellProps) {
  const Icon = spec.icon;
  const href = `/docs/signals#${spec.family}` as LinkHref;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 bg-[var(--surface)] p-6 transition-colors duration-150 hover:bg-[var(--surface-2)]"
      aria-label={ariaLabel}
    >
      <Icon
        size={18}
        strokeWidth={1.5}
        style={{ color: 'var(--fg-2)' }}
        aria-hidden
      />
      <div className="flex items-baseline gap-2 mt-1">
        <h3
          className="text-[15px] font-semibold leading-tight text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {spec.family}
        </h3>
        <span className="mono tabular text-[11px] text-[var(--fg-3)]">
          · {spec.weight}
        </span>
      </div>
      <p className="text-[13px] text-[var(--fg-2)] leading-relaxed mt-1">
        {description}
      </p>
    </Link>
  );
}

export async function SixSignals() {
  const t = await getTranslations('sixSignals');

  return (
    <section
      aria-labelledby="six-signals-title"
      className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40"
    >
      <GsapHeadline
        className="flex flex-col gap-4 max-w-[60ch]"
        eyebrow={<SectionEyebrow>{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="six-signals-title"
        titleClassName="text-3xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
        subClassName="text-[var(--fg-2)] max-w-[58ch] leading-relaxed"
      />

      <MotionReveal>
        <div className="mt-20 grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[var(--border)] rounded-2xl overflow-hidden">
          {FAMILIES.map((spec) => (
            <FamilyCell
              key={spec.family}
              spec={spec}
              description={t(`families.${spec.family}.description`)}
              ariaLabel={t('ariaLabel', { family: spec.family })}
            />
          ))}
        </div>
      </MotionReveal>
    </section>
  );
}
