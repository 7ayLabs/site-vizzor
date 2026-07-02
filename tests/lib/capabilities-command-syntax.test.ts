import { describe, it, expect } from 'vitest';
import {
  COMMAND_KEYWORD,
  COMMAND_TEMPLATE,
  TEMPLATE_CARET_POSITION,
  buildCommandTemplate,
  detectPartialCommand,
  parseCommand,
  stripCommand,
} from '@/lib/capabilities/command-syntax';

/**
 * The command grammar is the boundary between "user prose" and "user
 * intent". If the parser silently accepts a partial match or drops
 * a required field, the composer would ship a malformed intent to
 * /api/capabilities/create-intent — server 400 in the best case,
 * confused wallet prompt in the worst. Every test below locks a
 * specific invariant of the parser.
 */

describe('COMMAND_TEMPLATE — minimalist, placeholder-free', () => {
  it('templates end with a trailing space so the recipient starts fresh', () => {
    for (const cap of Object.keys(COMMAND_TEMPLATE)) {
      const t = COMMAND_TEMPLATE[cap as keyof typeof COMMAND_TEMPLATE];
      expect(t.endsWith('→ ')).toBe(true);
    }
  });

  it('no angle-bracketed placeholder embedded in the template', () => {
    for (const cap of Object.keys(COMMAND_TEMPLATE)) {
      const t = COMMAND_TEMPLATE[cap as keyof typeof COMMAND_TEMPLATE];
      expect(t).not.toMatch(/<[^>]+>/);
    }
  });

  it('TEMPLATE_CARET_POSITION lands the caret at end-of-string', () => {
    for (const cap of Object.keys(COMMAND_TEMPLATE)) {
      const t = COMMAND_TEMPLATE[cap as keyof typeof COMMAND_TEMPLATE];
      const pos =
        TEMPLATE_CARET_POSITION[cap as keyof typeof COMMAND_TEMPLATE];
      expect(pos).toBe(t.length);
    }
  });

  it('every template starts with its keyword — no slash prefix', () => {
    for (const cap of Object.keys(COMMAND_TEMPLATE)) {
      const t = COMMAND_TEMPLATE[cap as keyof typeof COMMAND_TEMPLATE];
      const kw = COMMAND_KEYWORD[cap as keyof typeof COMMAND_KEYWORD];
      expect(t).toMatch(new RegExp(`^${kw}\\s`));
      expect(t).not.toMatch(/^\//);
    }
  });
});

describe('buildCommandTemplate — carousel symbol drives the template', () => {
  it('uses the passed symbol uppercase-normalized', () => {
    expect(buildCommandTemplate('transfer', 'btc')).toBe('send 0.1 BTC → ');
    expect(buildCommandTemplate('transfer', 'ETH')).toBe('send 0.1 ETH → ');
  });

  it('falls back to SOL when no symbol is supplied', () => {
    expect(buildCommandTemplate('transfer')).toBe('send 0.1 SOL → ');
  });

  it('respects a caller-supplied amount', () => {
    expect(buildCommandTemplate('payment', 'USDC', '25')).toBe(
      'pay 25 USDC → ',
    );
  });

  it('both shipping keywords compose correctly', () => {
    expect(buildCommandTemplate('transfer', 'SOL')).toBe('send 0.1 SOL → ');
    expect(buildCommandTemplate('payment', 'SOL')).toBe('pay 0.1 SOL → ');
  });
});

describe('parseCommand — happy path', () => {
  it('parses "send 0.05 SOL → <addr>"', () => {
    const r = parseCommand('send 0.05 SOL → abcdefghijklmnop');
    expect(r).not.toBeNull();
    expect(r?.capability).toBe('transfer');
    expect(r?.amount).toBe('0.05');
    expect(r?.symbol).toBe('SOL');
    expect(r?.toAddr).toBe('abcdefghijklmnop');
  });

  it('parses "send 0.05 SOL to <addr>" — falls back to word "to"', () => {
    const r = parseCommand('send 0.05 SOL to abcdefghijklmnop');
    expect(r).not.toBeNull();
    expect(r?.capability).toBe('transfer');
  });

  it('parses "pay 100 USDC → <addr>" → payment', () => {
    const r = parseCommand('pay 100 USDC → zzzzzzzzzzzzzzzzz');
    expect(r?.capability).toBe('payment');
  });

  it('does not parse dropped v0.5.0 keywords (flow / auto)', () => {
    expect(parseCommand('auto 0.1 SOL → abcdefghijklmnop')).toBeNull();
    expect(parseCommand('flow 0.1 SOL → abcdefghijklmnop')).toBeNull();
  });

  it('accepts the keyword case-insensitively', () => {
    expect(parseCommand('SEND 0.1 SOL → abcdefghijklmnop')?.capability).toBe(
      'transfer',
    );
    expect(parseCommand('Send 0.1 SOL → abcdefghijklmnop')?.capability).toBe(
      'transfer',
    );
  });

  it('finds a mid-sentence command', () => {
    const text = 'hey send 0.05 SOL → abcdefghijklmnop and forecast';
    const r = parseCommand(text);
    expect(r).not.toBeNull();
    expect(r?.capability).toBe('transfer');
    expect(text.slice(r!.matchStart, r!.matchEnd)).toBe(r!.raw);
  });
});

describe('parseCommand — reject malformed prompts', () => {
  it('null when the amount is missing', () => {
    expect(parseCommand('send SOL → abcdefghijklmnop')).toBeNull();
  });

  it('null when the recipient is too short', () => {
    expect(parseCommand('send 0.05 SOL → short')).toBeNull();
  });

  it('null when the separator is missing', () => {
    expect(parseCommand('send 0.05 SOL abcdefghijklmnop')).toBeNull();
  });

  it('null on unknown keyword', () => {
    expect(parseCommand('delete 0.05 SOL → abcdefghijklmnop')).toBeNull();
  });

  it('null when keyword is part of a longer word (word-boundary)', () => {
    // "resend" should NOT match "send"
    expect(parseCommand('resend 0.05 SOL → abcdefghijklmnop')).toBeNull();
  });

  it('accepts a lowercase symbol and normalizes to uppercase', () => {
    const r = parseCommand('send 0.05 sol → abcdefghijklmnop');
    expect(r?.symbol).toBe('SOL');
  });
});

describe('detectPartialCommand', () => {
  it('returns transfer for a bare "send"', () => {
    expect(detectPartialCommand('send ')).toBe('transfer');
    expect(detectPartialCommand('send 0.05')).toBe('transfer');
  });

  it('returns null when no keyword present', () => {
    expect(detectPartialCommand('hello')).toBeNull();
  });

  it('case-insensitive keyword detection', () => {
    expect(detectPartialCommand('SEND now')).toBe('transfer');
    expect(detectPartialCommand('Pay later')).toBe('payment');
  });
});

describe('stripCommand — residue flows to /predict', () => {
  it('removes the command and collapses whitespace', () => {
    const text = 'hey send 0.05 SOL → abcdefghijklmnop and forecast';
    const r = parseCommand(text)!;
    expect(stripCommand(text, r)).toBe('hey and forecast');
  });

  it('returns empty string when the prompt is only the command', () => {
    const text = 'send 0.05 SOL → abcdefghijklmnop';
    const r = parseCommand(text)!;
    expect(stripCommand(text, r)).toBe('');
  });
});
