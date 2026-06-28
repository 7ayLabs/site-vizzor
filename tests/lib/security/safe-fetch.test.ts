import { describe, it, expect } from 'vitest';
import {
  validateOutboundUrl,
  SsrfBlockedError,
} from '@/lib/security/safe-fetch';

/**
 * Every URL below MUST be rejected. The validator never makes a real
 * network call for a literal-IP host (short-circuited), so these tests
 * are deterministic and offline.
 */
const LITERAL_BLOCKED = [
  'https://127.0.0.1/x',
  'https://127.5.5.5/x',
  'https://10.0.0.1/x',
  'https://10.255.255.255/x',
  'https://172.16.0.1/x',
  'https://172.31.255.255/x',
  'https://192.168.0.1/x',
  'https://192.168.255.255/x',
  'https://169.254.169.254/latest/meta-data/', // AWS metadata
  'https://169.254.0.1/x', // link-local
  'https://0.0.0.1/x',
  'https://100.64.0.1/x',
  'https://224.0.0.1/x', // multicast
  'https://240.0.0.1/x', // reserved
  'https://[::1]/x',
  'https://[fe80::1]/x',
  'https://[fc00::1]/x',
  'https://[fd00::1]/x',
  'https://[::ffff:127.0.0.1]/x',
];

const SCHEME_BLOCKED = [
  'http://example.com/x',
  'file:///etc/passwd',
  'gopher://example.com/x',
  'data:text/plain,xx',
];

describe('safe-fetch / validateOutboundUrl', () => {
  for (const url of LITERAL_BLOCKED) {
    it(`refuses ${url}`, async () => {
      await expect(validateOutboundUrl(url)).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    });
  }

  for (const url of SCHEME_BLOCKED) {
    it(`refuses non-https scheme ${url}`, async () => {
      await expect(validateOutboundUrl(url)).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    });
  }

  it('refuses junk strings', async () => {
    await expect(validateOutboundUrl('not a url')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('refuses empty host', async () => {
    await expect(validateOutboundUrl('https://')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });
});
