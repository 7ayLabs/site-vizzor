/**
 * Command catalog — declarative, framework-agnostic.
 *
 * Each entry knows its label, hint, group, and what to do when picked
 * (`run`). The palette UI calls `filterCommands(query, catalog)` and
 * `command.run(ctx)` — no framework coupling here, so the catalog can
 * be unit-tested without React.
 *
 * Adding a command: drop a new entry into `buildCommandCatalog()` —
 * both the palette and any future "all commands" docs page pick it up.
 * Destructive commands (sign out, delete) MUST set `danger: true` so
 * the palette renders a confirmation step before invoking `run`.
 */

import type { Route } from 'next';

export type CommandGroup = 'navigate' | 'action' | 'external';

export interface CommandContext {
  /** Navigation primitive — wired by the palette to next-intl's router. */
  navigate: (href: Route | string) => void;
  /** v0.5.4 — first-time-login guided tour controls. Populated when
   *  the palette is under <TourProvider>. Guards with `?.open?.()` so
   *  the catalog stays runnable in unit tests without the provider. */
  tour?: {
    open: () => void;
  };
}

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: CommandGroup;
  /** True when the action has irreversible side-effects. The palette
   *  prompts a second-step confirm before invoking `run`. */
  danger?: boolean;
  run: (ctx: CommandContext) => void;
}

const GROUP_LABEL: Record<CommandGroup, string> = {
  navigate: 'Navigate',
  action: 'Actions',
  external: 'External',
};

export function groupLabelFor(group: CommandGroup): string {
  return GROUP_LABEL[group];
}

/**
 * Build the v1 catalog. The list is static for now; future iterations
 * will inject dynamic entries (recent threads from useConversations,
 * Show-onboarding when Phase F lands).
 */
export function buildCommandCatalog(): readonly Command[] {
  const items: Command[] = [
    {
      id: 'nav:chat',
      label: 'Go to Chat',
      hint: '/app/predict',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/app/predict'),
    },
    {
      id: 'nav:whales',
      label: 'Go to Whale Terminal',
      hint: '/app/whales · Elite',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/app/whales'),
    },
    {
      id: 'nav:flow',
      label: 'Go to Flow Heatmap',
      hint: '/app/flow · Elite',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/app/flow'),
    },
    {
      id: 'nav:billing',
      label: 'Go to Billing',
      hint: 'Payment history',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/app/billing'),
    },
    {
      id: 'nav:settings',
      label: 'Go to Settings',
      hint: 'Account preferences',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/app/settings'),
    },
    {
      id: 'nav:pricing',
      label: 'View Pricing',
      hint: '/pricing',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/pricing'),
    },
    {
      id: 'nav:docs',
      label: 'Open Documentation',
      hint: '/docs',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/docs'),
    },
    {
      id: 'nav:manifesto',
      label: 'Read the Manifesto',
      hint: '/manifesto',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/manifesto'),
    },
    {
      id: 'nav:blog',
      label: 'Open Blog',
      hint: 'Stories and releases',
      group: 'navigate',
      run: (ctx) => ctx.navigate('/blog'),
    },
    {
      id: 'action:show-tour',
      label: 'Show tour',
      hint: 'Replay the guided /app/predict walkthrough',
      group: 'action',
      run: (ctx) => ctx.tour?.open?.(),
    },
    {
      id: 'ext:telegram',
      label: 'Open in Telegram',
      hint: '@vizzorai_bot',
      group: 'external',
      run: () => {
        if (typeof window !== 'undefined') {
          window.open('https://t.me/vizzorai_bot', '_blank', 'noopener');
        }
      },
    },
  ];
  return items;
}

/**
 * Score a command against a query.
 *
 *   0: no match (excluded)
 *   1: substring match in hint
 *   2: substring match in label
 *   3: prefix match in label
 *
 * Higher scores rank higher in the result list, ties broken by
 * insertion order (stable sort).
 */
function scoreCommand(cmd: Command, query: string): number {
  if (!query) return 1;
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 1;
  const label = cmd.label.toLowerCase();
  const hint = (cmd.hint ?? '').toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if (hint.includes(q)) return 1;
  return 0;
}

/**
 * Filter + rank a catalog against a query. Empty query returns the
 * whole catalog in its declared order; non-empty queries return only
 * matches, ranked by score descending and tied by declared order.
 */
export function filterCommands(
  query: string,
  catalog: readonly Command[],
): readonly Command[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return catalog;
  const ranked = catalog
    .map((cmd, idx) => ({ cmd, idx, score: scoreCommand(cmd, trimmed) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return ranked.map((r) => r.cmd);
}
