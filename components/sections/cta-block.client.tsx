/**
 * CtaParticleBackground — client wrapper that lazy-loads `<ParticleConverge>`.
 *
 * R3F components can only be dynamic-imported with `ssr: false` from a
 * client component. We isolate that import here so the section shell
 * stays a server component.
 */
'use client';

import dynamic from 'next/dynamic';

const ParticleConverge = dynamic(
  () =>
    import('@/components/three/particle-converge').then((m) => ({
      default: m.ParticleConverge,
    })),
  { ssr: false },
);

export interface CtaParticleBackgroundProps {
  height?: number;
}

export function CtaParticleBackground({
  height = 360,
}: CtaParticleBackgroundProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
      style={{ opacity: 0.5 }}
    >
      <div className="w-full max-w-[720px]">
        <ParticleConverge target={[0, -1, 0]} height={height} />
      </div>
    </div>
  );
}
