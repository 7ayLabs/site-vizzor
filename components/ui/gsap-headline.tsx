/**
 * GsapHeadline — choreographed entry for a section's eyebrow + title + sub.
 *
 * The order is deliberate: eyebrow lands first (it's a label that primes the
 * eye), then the title reveals word-by-word with a tight stagger, then the
 * sub paragraph fades up. Trigger is a one-shot IntersectionObserver so the
 * animation runs the first time the headline enters the viewport and never
 * again — no scroll-y replay loops.
 *
 * We DO NOT import gsap/ScrollTrigger here; a vanilla IO trigger plus a
 * single gsap timeline keeps the bundle delta minimal.
 *
 * Reduced motion: the timeline never starts; items snap to their final state
 * via the same `gsap.set` calls we'd use for "to" targets.
 *
 * Title word splitting: when `title` is a plain string we split on whitespace
 * and render each word as its own animated <span>. For arbitrary ReactNodes
 * (icons, breaks, mixed runs) we treat the title as one animation target so
 * we never mangle the user's markup.
 */
'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface GsapHeadlineProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  titleClassName?: string;
  subClassName?: string;
  className?: string;
  /** Optional id forwarded to the <h2> for aria-labelledby links. */
  titleId?: string;
  /** Heading level — defaults to h2; the hero uses h1. */
  as?: 'h1' | 'h2';
  /**
   * When true, layers a 200ms 1px RGB-split on initial reveal — terminal
   * aesthetic. No-op under reduced motion. Defaults to false, preserving
   * every current call site exactly.
   */
  glitch?: boolean;
}

function splitTitleWords(node: React.ReactNode): string[] | null {
  if (typeof node !== 'string') return null;
  const trimmed = node.trim();
  if (trimmed.length === 0) return null;
  return trimmed.split(/\s+/);
}

export function GsapHeadline({
  eyebrow,
  title,
  sub,
  titleClassName,
  subClassName,
  className,
  titleId,
  as = 'h2',
  glitch = false,
}: GsapHeadlineProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const eyebrowRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const subRef = useRef<HTMLParagraphElement | null>(null);
  const wordRefs = useRef<HTMLSpanElement[]>([]);

  const titleWords = splitTitleWords(title);

  useGSAP(
    () => {
      if (typeof window === 'undefined') return;

      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;

      const eyebrowEl = eyebrowRef.current;
      const titleEl = titleRef.current;
      const subEl = subRef.current;
      const words = wordRefs.current.filter((el): el is HTMLSpanElement =>
        Boolean(el),
      );

      // Targets we'll be animating — collect non-null only.
      const eyebrowTargets = eyebrowEl ? [eyebrowEl] : [];
      const titleTargets: HTMLElement[] = titleWords && words.length
        ? words
        : titleEl
          ? [titleEl]
          : [];
      const subTargets = subEl ? [subEl] : [];

      // Initial state — set even under reduced motion so the snap-to-final
      // override below is unambiguous.
      if (eyebrowTargets.length)
        gsap.set(eyebrowTargets, { opacity: 0, y: 8 });
      if (titleTargets.length)
        gsap.set(titleTargets, { opacity: 0, y: 18 });
      if (subTargets.length) gsap.set(subTargets, { opacity: 0, y: 12 });

      if (reduced) {
        // Snap everything to final.
        if (eyebrowTargets.length)
          gsap.set(eyebrowTargets, { opacity: 1, y: 0 });
        if (titleTargets.length)
          gsap.set(titleTargets, { opacity: 1, y: 0 });
        if (subTargets.length) gsap.set(subTargets, { opacity: 1, y: 0 });
        return;
      }

      const wrap = wrapRef.current;
      if (!wrap) return;

      let played = false;
      const play = () => {
        if (played) return;
        played = true;

        const tl = gsap.timeline();
        if (eyebrowTargets.length) {
          tl.to(eyebrowTargets, {
            opacity: 1,
            y: 0,
            duration: 0.35,
            ease: 'power2.out',
          });
        }
        if (titleTargets.length) {
          tl.to(
            titleTargets,
            {
              opacity: 1,
              y: 0,
              duration: 0.45,
              ease: 'power3.out',
              stagger: titleWords && words.length ? 0.04 : 0,
            },
            eyebrowTargets.length ? '-=0.3' : 0,
          );

          // Glitch: short RGB-split overlay on the heading element itself
          // (we tint the parent h-tag so all word spans inherit). Drop it
          // back to none after 200ms so the heading settles crisp.
          if (glitch && titleEl) {
            tl.set(
              titleEl,
              {
                textShadow:
                  '1px 0 0 var(--accent), -1px 0 0 var(--danger)',
              },
              '-=0.1',
            )
              .set(
                titleEl,
                { textShadow: 'none' },
                '+=0.2',
              );
          }
        }
        if (subTargets.length) {
          tl.to(
            subTargets,
            {
              opacity: 1,
              y: 0,
              duration: 0.4,
              ease: 'power2.out',
            },
            '-=0.1',
          );
        }
      };

      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              play();
              io.unobserve(entry.target);
              break;
            }
          }
        },
        { threshold: 0.05, rootMargin: '0px 0px -5% 0px' },
      );
      io.observe(wrap);

      return () => io.disconnect();
    },
    { scope: wrapRef, dependencies: [titleWords?.join(' ') ?? '', glitch] },
  );

  const TitleTag = as;

  return (
    <div ref={wrapRef} className={className}>
      {eyebrow && (
        <div ref={eyebrowRef}>
          {eyebrow}
        </div>
      )}

      <TitleTag
        ref={titleRef as React.Ref<HTMLHeadingElement>}
        id={titleId}
        className={titleClassName}
      >
        {titleWords ? (
          titleWords.map((word, idx) => (
            <span
              key={`${word}-${idx}`}
              ref={(el) => {
                if (el) wordRefs.current[idx] = el;
              }}
              className={cn('inline-block', 'will-change-transform')}
              // Per-word inline-block + whitespace via trailing space so
              // line breaks still wrap naturally between words.
            >
              {word}
              {idx < titleWords.length - 1 ? ' ' : ''}
            </span>
          ))
        ) : (
          title
        )}
      </TitleTag>

      {sub && (
        <p ref={subRef} className={subClassName}>
          {sub}
        </p>
      )}
    </div>
  );
}
