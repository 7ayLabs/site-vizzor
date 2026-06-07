/**
 * Vitest configuration for site-vizzor.
 *
 * Test surface is server-side (API routes, lib/*), so the default
 * environment is node. The setup file at tests/setup.ts wires a
 * per-test SQLite database in /tmp so production data is never
 * touched and tests are fully isolated.
 *
 * Coverage targets lib/** and app/api/** — the surfaces that this
 * branch's deliverables must validate per v0.2.0 RFC invariant #4.
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**', 'app/api/**'],
      exclude: [
        '**/*.d.ts',
        '**/node_modules/**',
        'tests/**',
      ],
      reportsDirectory: './coverage',
    },
  },
});
