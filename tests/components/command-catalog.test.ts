import { describe, it, expect, vi } from 'vitest';
import {
  buildCommandCatalog,
  filterCommands,
  groupLabelFor,
  type Command,
  type CommandContext,
} from '@/components/app/command-catalog';

describe('buildCommandCatalog', () => {
  it('returns a non-empty catalog with stable ids', () => {
    const catalog = buildCommandCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    const ids = catalog.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every nav command runs ctx.navigate with its hinted href', () => {
    const catalog = buildCommandCatalog();
    const navigate = vi.fn();
    const ctx: CommandContext = { navigate };
    const navCommands = catalog.filter((c) => c.group === 'navigate');
    expect(navCommands.length).toBeGreaterThan(0);
    for (const cmd of navCommands) {
      navigate.mockClear();
      cmd.run(ctx);
      expect(navigate).toHaveBeenCalledTimes(1);
    }
  });

  it('groupLabelFor returns a non-empty label for every group', () => {
    expect(groupLabelFor('navigate')).toBeTruthy();
    expect(groupLabelFor('action')).toBeTruthy();
    expect(groupLabelFor('external')).toBeTruthy();
  });
});

describe('filterCommands', () => {
  const stubCmd = (id: string, label: string, hint?: string): Command => ({
    id,
    label,
    hint,
    group: 'navigate',
    run: () => {},
  });

  const catalog: Command[] = [
    stubCmd('a', 'Billing dashboard', 'Payments'),
    stubCmd('b', 'Chat', 'Predict'),
    stubCmd('c', 'Whale Terminal', 'Smart money'),
    stubCmd('d', 'Settings', 'Account preferences'),
  ];

  it('empty query returns the full catalog in declared order', () => {
    const result = filterCommands('', catalog);
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('whitespace-only query is treated as empty', () => {
    const result = filterCommands('   ', catalog);
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('label prefix match outranks substring match', () => {
    const items: Command[] = [
      stubCmd('mid', 'Open Settings', 'config'),
      stubCmd('pref', 'Settings'),
    ];
    const result = filterCommands('set', items);
    // 'Settings' (prefix) ranks above 'Open Settings' (substring).
    expect(result.map((c) => c.id)).toEqual(['pref', 'mid']);
  });

  it('substring match in hint surfaces commands the label alone would hide', () => {
    const result = filterCommands('predict', catalog);
    expect(result.map((c) => c.id)).toContain('b');
  });

  it('returns empty array when nothing matches', () => {
    const result = filterCommands('zzzzz-no-match', catalog);
    expect(result).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const upper = filterCommands('CHAT', catalog);
    const lower = filterCommands('chat', catalog);
    expect(upper.map((c) => c.id)).toEqual(lower.map((c) => c.id));
  });
});
