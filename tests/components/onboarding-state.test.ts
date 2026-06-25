import { describe, it, expect } from 'vitest';
import { nextPhase } from '@/components/app/use-onboarding';

/**
 * The OnboardingStepper's state machine boils down to one pure
 * function (`nextPhase`) + a localStorage flag + a React effect that
 * watches the external `signedIn` prop. The React surface is best
 * verified by manual smoke (per the plan); these tests pin the pure
 * function so future refactors don't silently break the step ordering.
 */
describe('nextPhase', () => {
  it('advances through the canonical order', () => {
    expect(nextPhase('connect')).toBe('siws');
    expect(nextPhase('siws')).toBe('trial-intro');
    expect(nextPhase('trial-intro')).toBe('done');
  });

  it('terminal phases collapse to closed', () => {
    expect(nextPhase('done')).toBe('closed');
    expect(nextPhase('closed')).toBe('closed');
  });

  it('walking from connect to done takes exactly three advances', () => {
    let phase: ReturnType<typeof nextPhase> = 'connect';
    phase = nextPhase(phase); // siws
    phase = nextPhase(phase); // trial-intro
    phase = nextPhase(phase); // done
    expect(phase).toBe('done');
  });
});
