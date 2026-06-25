import { describe, it, expect } from 'vitest';
import {
  buildSolscanTxUrl,
  buildSolscanAccountUrl,
  buildSolanaExplorerTxUrl,
  buildSolanaExplorerAccountUrl,
} from '@/lib/explorer/solana';
import {
  buildTonviewerTxUrl,
  buildTonviewerAccountUrl,
  buildTonscanTxUrl,
  buildTonscanAccountUrl,
} from '@/lib/explorer/ton';

describe('lib/explorer/solana', () => {
  const sig = '5KQz1AbcD123FakeSigForTestingPurposesOnlyXYZ';
  const addr = '4Az3pQ8FakeWalletAddressForTesting7PqRsTu9Xv';

  it.each([
    ['mainnet', `https://solscan.io/tx/${sig}`],
    ['testnet', `https://solscan.io/tx/${sig}?cluster=testnet`],
    ['devnet', `https://solscan.io/tx/${sig}?cluster=devnet`],
  ] as const)('Solscan tx URL on %s drops cluster query when mainnet', (net, expected) => {
    expect(buildSolscanTxUrl(sig, net)).toBe(expected);
  });

  it('Solscan account URL respects cluster', () => {
    expect(buildSolscanAccountUrl(addr, 'mainnet')).toBe(
      `https://solscan.io/account/${addr}`,
    );
    expect(buildSolscanAccountUrl(addr, 'devnet')).toBe(
      `https://solscan.io/account/${addr}?cluster=devnet`,
    );
  });

  it('Solana Explorer tx URL respects cluster', () => {
    expect(buildSolanaExplorerTxUrl(sig, 'mainnet')).toBe(
      `https://explorer.solana.com/tx/${sig}`,
    );
    expect(buildSolanaExplorerTxUrl(sig, 'devnet')).toBe(
      `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    );
  });

  it('Solana Explorer account URL respects cluster', () => {
    expect(buildSolanaExplorerAccountUrl(addr, 'testnet')).toBe(
      `https://explorer.solana.com/address/${addr}?cluster=testnet`,
    );
  });
});

describe('lib/explorer/ton', () => {
  const hash = 'AbcDefGhi123FakeTonHashForTesting==';
  const addr = 'EQAbc123FakeTonAddressForTesting456';

  it('Tonviewer tx URL switches host between mainnet and testnet', () => {
    expect(buildTonviewerTxUrl(hash, 'mainnet')).toBe(
      `https://tonviewer.com/transaction/${hash}`,
    );
    expect(buildTonviewerTxUrl(hash, 'testnet')).toBe(
      `https://testnet.tonviewer.com/transaction/${hash}`,
    );
  });

  it('Tonviewer account URL on devnet falls through to testnet (TON has no devnet)', () => {
    expect(buildTonviewerAccountUrl(addr, 'devnet')).toBe(
      `https://testnet.tonviewer.com/${addr}`,
    );
  });

  it('Tonscan tx URL switches host between mainnet and testnet', () => {
    expect(buildTonscanTxUrl(hash, 'mainnet')).toBe(
      `https://tonscan.org/tx/${hash}`,
    );
    expect(buildTonscanTxUrl(hash, 'testnet')).toBe(
      `https://testnet.tonscan.org/tx/${hash}`,
    );
  });

  it('Tonscan account URL on mainnet vs devnet', () => {
    expect(buildTonscanAccountUrl(addr, 'mainnet')).toBe(
      `https://tonscan.org/address/${addr}`,
    );
    expect(buildTonscanAccountUrl(addr, 'devnet')).toBe(
      `https://testnet.tonscan.org/address/${addr}`,
    );
  });
});
