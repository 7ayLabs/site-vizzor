import { describe, it, expect } from 'vitest';
import {
  setActiveSkillForWallet,
  setPinnedItemForWallet,
  getWalletPreferences,
} from '@/lib/payment/db';
import { MAX_PINNED_ITEMS, getPinnedItemIds } from '@/lib/directory/runtime';

const WALLET = 'PinPinPinPinPinPinPinPinPinPinPinPinPinPinPin';

describe('pinned items round-trip', () => {
  it('starts with no pins for a fresh wallet', () => {
    expect(getPinnedItemIds(WALLET)).toEqual([]);
  });

  it('persists a pin without touching active_skill_id', () => {
    setActiveSkillForWallet(WALLET, 'memecoin-sniper');
    setPinnedItemForWallet(WALLET, 'whale-tracker', true);

    expect(getPinnedItemIds(WALLET)).toEqual(['whale-tracker']);

    const prefs = getWalletPreferences(WALLET);
    expect(prefs?.active_skill_id).toBe('memecoin-sniper');
  });

  it('accumulates pins as a set (no duplicates)', () => {
    setPinnedItemForWallet(WALLET, 'whale-tracker', true);
    setPinnedItemForWallet(WALLET, 'conservative-trend', true);
    setPinnedItemForWallet(WALLET, 'whale-tracker', true); // dup pin

    const pins = getPinnedItemIds(WALLET);
    expect(pins.sort()).toEqual(['conservative-trend', 'whale-tracker']);
  });

  it('un-pins by passing pinned=false', () => {
    setPinnedItemForWallet(WALLET, 'whale-tracker', true);
    setPinnedItemForWallet(WALLET, 'conservative-trend', true);
    setPinnedItemForWallet(WALLET, 'whale-tracker', false);

    expect(getPinnedItemIds(WALLET)).toEqual(['conservative-trend']);
  });

  it('stores connector pins alongside skill pins (category-agnostic)', () => {
    setPinnedItemForWallet(WALLET, 'memecoin-sniper', true);
    setPinnedItemForWallet(WALLET, 'discord-webhook', true);
    setPinnedItemForWallet(WALLET, 'telegram', true);

    const pins = getPinnedItemIds(WALLET).sort();
    expect(pins).toEqual(['discord-webhook', 'memecoin-sniper', 'telegram']);
  });

  it('exposes a MAX_PINNED_ITEMS cap of 5', () => {
    // The cap lives on the runtime module so the API route + the
    // Directory UI agree on the same number. The DB helper itself
    // stays dumb (no cap inside SQLite); the route enforces.
    expect(MAX_PINNED_ITEMS).toBe(5);
  });
});
