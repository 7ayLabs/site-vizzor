/**
 * Smoke test that the global setup wired the test DB path correctly.
 * Acts as a canary for the Vitest configuration itself.
 */

import { describe, it, expect } from 'vitest';

describe('test setup', () => {
  it('points VIZZOR_SITE_DB at /tmp', () => {
    expect(process.env.VIZZOR_SITE_DB).toMatch(/^\/tmp\/vizzor-test-\d+\.db$/);
  });

  it('sets NODE_ENV to test', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('enables Solana payments feature flag for createSession paths', () => {
    expect(process.env.NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS).toBe('true');
  });
});
