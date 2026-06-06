/**
 * Local type shim for the test stubs.
 *
 * The C2 (`feature/v0.2.0/wallet-telegram-binding`) sub-branch ships
 * test-file stubs that import `describe`/`it`/`it.todo` from `vitest`.
 * The real Vitest devDep and `vitest.config.ts` are installed by C5
 * (`feature/v0.2.0/payment-qa`) per the merge-order plan in
 * `docs/rfc/v0.2.0/architecture.md` §3.
 *
 * Until C5 lands, this shim keeps `pnpm typecheck` green on the C2
 * branch in isolation. When C5 merges into `release/v0.2.0`, the
 * `vitest` package's bundled types take precedence (TypeScript prefers
 * a real module declaration over an ambient one with the same name),
 * and `tests/vitest-shim.d.ts` is expected to be deleted by C5's first
 * commit. We leave a deletion-tracking note here so the C5 integrator
 * can grep for it.
 *
 * If you are reading this file in `release/v0.2.0` HEAD after C5 has
 * merged, delete it. It exists only as a build seam for the period
 * when C2 ships ahead of C5.
 */

declare module 'vitest' {
  type TodoFn = (name: string) => void;
  interface TestApi {
    (name: string, fn: () => void | Promise<void>): void;
    todo: TodoFn;
  }
  export const describe: (name: string, fn: () => void) => void;
  export const it: TestApi;
  export const test: TestApi;
  export const expect: (value: unknown) => {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toMatch(pattern: RegExp | string): void;
    toHaveLength(length: number): void;
    toThrow(error?: RegExp | string | Error): void;
    not: {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
    };
  };
  export const beforeAll: (fn: () => void | Promise<void>) => void;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const afterAll: (fn: () => void | Promise<void>) => void;
  export const afterEach: (fn: () => void | Promise<void>) => void;
  export const vi: {
    fn<T extends (...args: never[]) => unknown>(impl?: T): T;
    spyOn<T extends object, K extends keyof T>(obj: T, key: K): T[K];
    mock(path: string, factory?: () => unknown): void;
    resetAllMocks(): void;
    restoreAllMocks(): void;
  };
}
