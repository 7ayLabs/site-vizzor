import { describe, it, expect } from 'vitest';
import { tierSatisfies } from '@/lib/directory/catalog';

describe('tierSatisfies', () => {
  it('anonymous (null) passes only free entries', () => {
    expect(tierSatisfies(null, 'free')).toBe(true);
    expect(tierSatisfies(null, 'pro')).toBe(false);
    expect(tierSatisfies(null, 'elite')).toBe(false);
  });

  it('free callers can install free, not pro/elite', () => {
    expect(tierSatisfies('free', 'free')).toBe(true);
    expect(tierSatisfies('free', 'pro')).toBe(false);
    expect(tierSatisfies('free', 'elite')).toBe(false);
  });

  it('pro callers can install free + pro, not elite', () => {
    expect(tierSatisfies('pro', 'free')).toBe(true);
    expect(tierSatisfies('pro', 'pro')).toBe(true);
    expect(tierSatisfies('pro', 'elite')).toBe(false);
  });

  it('elite callers pass every entry', () => {
    expect(tierSatisfies('elite', 'free')).toBe(true);
    expect(tierSatisfies('elite', 'pro')).toBe(true);
    expect(tierSatisfies('elite', 'elite')).toBe(true);
  });
});
