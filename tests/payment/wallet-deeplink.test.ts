/**
 * wallet/deeplink.ts — Phantom / Solflare Connect Protocol primitives.
 *
 * Asserts:
 *   - connect URL contains every required query param and uses the
 *     correct provider base path
 *   - signMessage URL contains every required query param
 *   - encrypt → decrypt round trip recovers the original signature
 *     payload using the shared secret
 *   - decryptConnectCallback reconstructs the same shared secret
 *     used by the (simulated) wallet side
 *   - decryptConnectCallback throws on tampered ciphertext
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  HANDOFF_TTL_MS,
  buildAndroidIntentUrl,
  buildConnectUrl,
  buildDappBrowserUrl,
  buildFallbackSchemeUrl,
  buildSignMessageUrl,
  clearHandoff,
  decryptConnectCallback,
  decryptSignMessageCallback,
  encodeSignMessagePayload,
  generateDappKeypair,
  isMobileWeb,
  isWalletBrowser,
  loadHandoff,
  saveHandoff,
  startDappBrowserHandoff,
  updateHandoff,
} from '@/lib/wallet/deeplink';

describe('buildConnectUrl', () => {
  it('targets phantom.com and carries every required param', () => {
    // Phantom moved their universal-link host from phantom.app to
    // phantom.com in 2025. Hitting the new host directly avoids the
    // 301 redirect that breaks iOS Universal Link interception.
    const url = new URL(
      buildConnectUrl({
        providerId: 'phantom',
        dappPublicKey: 'A'.repeat(43),
        redirectLink: 'https://vizzor.ai/wallet/callback?step=connect',
        cluster: 'mainnet-beta',
        appUrl: 'https://vizzor.ai',
      }),
    );
    expect(url.origin).toBe('https://phantom.com');
    expect(url.pathname).toBe('/ul/v1/connect');
    expect(url.searchParams.get('dapp_encryption_public_key')).toBe(
      'A'.repeat(43),
    );
    expect(url.searchParams.get('cluster')).toBe('mainnet-beta');
    expect(url.searchParams.get('app_url')).toBe('https://vizzor.ai');
    expect(url.searchParams.get('redirect_link')).toBe(
      'https://vizzor.ai/wallet/callback?step=connect',
    );
  });

  it('targets solflare.com for the solflare provider', () => {
    const url = new URL(
      buildConnectUrl({
        providerId: 'solflare',
        dappPublicKey: 'B'.repeat(43),
        redirectLink: 'https://vizzor.ai/wallet/callback?step=connect',
        cluster: 'devnet',
        appUrl: 'https://vizzor.ai',
      }),
    );
    expect(url.origin).toBe('https://solflare.com');
    expect(url.pathname).toBe('/ul/v1/connect');
    expect(url.searchParams.get('cluster')).toBe('devnet');
  });
});

describe('buildFallbackSchemeUrl', () => {
  it('rewrites a phantom.com universal link as a phantom:// scheme URL', () => {
    const universal = buildConnectUrl({
      providerId: 'phantom',
      dappPublicKey: 'A'.repeat(43),
      redirectLink: 'https://vizzor.ai/wallet/callback?step=connect',
      cluster: 'devnet',
      appUrl: 'https://vizzor.ai',
    });
    const scheme = buildFallbackSchemeUrl('phantom', universal);
    expect(scheme.startsWith('phantom:/ul/v1/connect?')).toBe(true);
    // Query params must round-trip exactly so the wallet sees the
    // same dapp_encryption_public_key / cluster / redirect_link the
    // universal link carries.
    const restored = new URL(`https://example.com${scheme.replace(/^phantom:/, '')}`);
    expect(restored.searchParams.get('dapp_encryption_public_key')).toBe('A'.repeat(43));
    expect(restored.searchParams.get('cluster')).toBe('devnet');
  });

  it('rewrites solflare universal links under the solflare:// scheme', () => {
    const universal = buildConnectUrl({
      providerId: 'solflare',
      dappPublicKey: 'B'.repeat(43),
      redirectLink: 'https://vizzor.ai/wallet/callback?step=connect',
      cluster: 'mainnet-beta',
      appUrl: 'https://vizzor.ai',
    });
    const scheme = buildFallbackSchemeUrl('solflare', universal);
    expect(scheme.startsWith('solflare:/ul/v1/connect?')).toBe(true);
  });
});

describe('buildAndroidIntentUrl', () => {
  it('wraps a phantom universal link as an Android Intent targeting app.phantom', () => {
    const universal = buildConnectUrl({
      providerId: 'phantom',
      dappPublicKey: 'A'.repeat(43),
      redirectLink: 'https://vizzor.ai/wallet/callback?step=connect',
      cluster: 'mainnet-beta',
      appUrl: 'https://vizzor.ai',
    });
    const intent = buildAndroidIntentUrl('phantom', universal);
    expect(intent.startsWith('intent://phantom.com/ul/v1/connect')).toBe(true);
    expect(intent).toContain('scheme=https');
    expect(intent).toContain('package=app.phantom');
    expect(intent).toContain('S.browser_fallback_url=');
    // The browser fallback must be the universal link — Android
    // routes to the Play Store / Phantom website when the app is
    // not installed.
    expect(intent).toContain(encodeURIComponent(universal));
    expect(intent.endsWith(';end')).toBe(true);
  });

  it('targets com.solflare.mobile for the solflare provider', () => {
    const universal = buildConnectUrl({
      providerId: 'solflare',
      dappPublicKey: 'B'.repeat(43),
      redirectLink: 'https://vizzor.ai/wallet/callback?step=connect',
      cluster: 'devnet',
      appUrl: 'https://vizzor.ai',
    });
    const intent = buildAndroidIntentUrl('solflare', universal);
    expect(intent).toContain('package=com.solflare.mobile');
  });
});

describe('buildSignMessageUrl', () => {
  it('carries dapp pubkey, nonce, payload, and redirect', () => {
    const url = new URL(
      buildSignMessageUrl({
        providerId: 'phantom',
        dappPublicKey: 'A'.repeat(43),
        nonce: 'noncebase58',
        payload: 'payloadbase58',
        redirectLink: 'https://vizzor.ai/wallet/callback?step=sign',
      }),
    );
    expect(url.pathname).toBe('/ul/v1/signMessage');
    expect(url.searchParams.get('nonce')).toBe('noncebase58');
    expect(url.searchParams.get('payload')).toBe('payloadbase58');
    expect(url.searchParams.get('redirect_link')).toBe(
      'https://vizzor.ai/wallet/callback?step=sign',
    );
  });
});

describe('connect-callback decryption', () => {
  it('decrypts the simulated wallet response into the wallet address + session', () => {
    const dapp = generateDappKeypair();
    const wallet = nacl.box.keyPair();
    const shared = nacl.box.before(dapp.publicKey, wallet.secretKey);

    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        public_key: 'WaLLeTaDdReSs11111111111111111111111111111111',
        session: 'opaque-session-token',
      }),
    );
    const nonce = nacl.randomBytes(24);
    const ciphertext = nacl.box.after(plaintext, nonce, shared);

    const result = decryptConnectCallback({
      phantomPublicKey: bs58.encode(wallet.publicKey),
      nonce: bs58.encode(nonce),
      data: bs58.encode(ciphertext),
      dappSecretKey: bs58.encode(dapp.secretKey),
    });

    expect(result.walletAddress).toBe(
      'WaLLeTaDdReSs11111111111111111111111111111111',
    );
    expect(result.sessionToken).toBe('opaque-session-token');
    // Shared secret must match what the wallet derived — proven by
    // reusing it to decrypt the same ciphertext above.
    expect(bs58.decode(result.sharedSecret)).toEqual(shared);
  });

  it('throws on tampered ciphertext', () => {
    const dapp = generateDappKeypair();
    const wallet = nacl.box.keyPair();
    const shared = nacl.box.before(dapp.publicKey, wallet.secretKey);
    const nonce = nacl.randomBytes(24);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ public_key: 'x', session: 'y' }),
    );
    const ciphertext = nacl.box.after(plaintext, nonce, shared);
    // Flip a byte in the middle of the ciphertext.
    const tampered = new Uint8Array(ciphertext);
    tampered[5] = (tampered[5]! + 1) & 0xff;

    expect(() =>
      decryptConnectCallback({
        phantomPublicKey: bs58.encode(wallet.publicKey),
        nonce: bs58.encode(nonce),
        data: bs58.encode(tampered),
        dappSecretKey: bs58.encode(dapp.secretKey),
      }),
    ).toThrow('decrypt_failed');
  });
});

describe('handoff persistence', () => {
  // Vitest's default environment is `node`, so we polyfill localStorage
  // here for these tests only — the wallet handoff is browser-only,
  // and the real fix lives in `lib/wallet/deeplink.ts` flipping from
  // sessionStorage to localStorage so the value survives iOS Safari's
  // habit of resuming the universal-link redirect in a NEW tab.
  beforeEach(() => {
    const bucket = new Map<string, string>();
    const stub: Storage = {
      getItem: (k: string) => bucket.get(k) ?? null,
      setItem: (k: string, v: string) => void bucket.set(k, v),
      removeItem: (k: string) => void bucket.delete(k),
      clear: () => bucket.clear(),
      key: (i: number) => Array.from(bucket.keys())[i] ?? null,
      get length() {
        return bucket.size;
      },
    };
    vi.stubGlobal('window', { localStorage: stub });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a saved handoff and stamps createdAt', () => {
    saveHandoff({
      providerId: 'phantom',
      dappPublicKey: 'pub',
      dappSecretKey: 'sec',
      returnTo: 'https://test.vizzor.ai/predict',
    });
    const loaded = loadHandoff();
    expect(loaded?.providerId).toBe('phantom');
    expect(loaded?.dappPublicKey).toBe('pub');
    expect(loaded?.dappSecretKey).toBe('sec');
    expect(loaded?.createdAt).toBeTypeOf('number');
    expect(loaded!.createdAt!).toBeLessThanOrEqual(Date.now());
  });

  it('preserves the original createdAt across updateHandoff', () => {
    saveHandoff({
      providerId: 'phantom',
      dappPublicKey: 'pub',
      dappSecretKey: 'sec',
      returnTo: 'https://test.vizzor.ai',
    });
    const first = loadHandoff();
    expect(first?.createdAt).toBeTypeOf('number');
    const originalCreatedAt = first!.createdAt!;
    // Update after a small delay — createdAt must stay pinned to
    // the first save so the TTL window doesn't slide.
    const updated = updateHandoff({ walletAddress: 'WAL123' });
    expect(updated?.walletAddress).toBe('WAL123');
    expect(updated?.createdAt).toBe(originalCreatedAt);
  });

  it('drops handoffs older than HANDOFF_TTL_MS and returns null', () => {
    const ancient = Date.now() - HANDOFF_TTL_MS - 1_000;
    saveHandoff({
      providerId: 'phantom',
      dappPublicKey: 'pub',
      dappSecretKey: 'sec',
      returnTo: 'https://test.vizzor.ai',
      createdAt: ancient,
    });
    expect(loadHandoff()).toBeNull();
    // The expired entry must be wiped — a later save shouldn't see it.
    expect(window.localStorage.getItem('vizzor.wallet.handoff')).toBeNull();
  });

  it('clearHandoff removes the stored entry', () => {
    saveHandoff({
      providerId: 'phantom',
      dappPublicKey: 'pub',
      dappSecretKey: 'sec',
      returnTo: 'https://test.vizzor.ai',
    });
    expect(loadHandoff()).not.toBeNull();
    clearHandoff();
    expect(loadHandoff()).toBeNull();
  });
});

describe('signMessage round trip', () => {
  it('encrypts the SIWS message and recovers the signature on return', () => {
    // Simulate the post-connect state: site holds sharedSecret + session,
    // wallet holds the same sharedSecret.
    const sharedSecret = bs58.encode(nacl.randomBytes(32));
    const sessionToken = 'opaque-session-token';
    const siws = 'vizzor.ai wants you to sign in...';

    const { nonce, payload } = encodeSignMessagePayload({
      sharedSecret,
      sessionToken,
      message: siws,
    });

    // Wallet side: decrypt the payload, inspect, then encrypt a fake
    // signature response under a fresh nonce.
    const sharedBytes = bs58.decode(sharedSecret);
    const decryptedRequest = nacl.box.open.after(
      bs58.decode(payload),
      bs58.decode(nonce),
      sharedBytes,
    );
    expect(decryptedRequest).not.toBeNull();
    const request = JSON.parse(new TextDecoder().decode(decryptedRequest!)) as {
      session: string;
      message: string;
      display: string;
    };
    expect(request.session).toBe(sessionToken);
    expect(new TextDecoder().decode(bs58.decode(request.message))).toBe(siws);

    // Wallet replies.
    const replyNonce = nacl.randomBytes(24);
    const replyPlain = new TextEncoder().encode(
      JSON.stringify({ signature: 'sigbase58encodedstring' }),
    );
    const replyCipher = nacl.box.after(replyPlain, replyNonce, sharedBytes);

    const result = decryptSignMessageCallback({
      sharedSecret,
      nonce: bs58.encode(replyNonce),
      data: bs58.encode(replyCipher),
    });
    expect(result.signature).toBe('sigbase58encodedstring');
  });
});

describe('buildDappBrowserUrl', () => {
  it('produces a phantom://browse/<encoded>?ref=<encoded> URL', () => {
    const target =
      'https://test.vizzor.ai/en/predict?action=connect&provider=phantom';
    const ref = 'https://test.vizzor.ai';
    const url = buildDappBrowserUrl('phantom', target, ref);
    expect(url.startsWith('phantom://browse/')).toBe(true);
    // The path segment carries the percent-encoded target.
    expect(url).toContain(encodeURIComponent(target));
    // The ref is on the query string.
    expect(url).toContain(`ref=${encodeURIComponent(ref)}`);
  });

  it('produces a solflare://ul/v1/browse/<encoded>?ref=<encoded> URL', () => {
    const target = 'https://test.vizzor.ai/en/predict';
    const ref = 'https://test.vizzor.ai';
    const url = buildDappBrowserUrl('solflare', target, ref);
    expect(url.startsWith('solflare://ul/v1/browse/')).toBe(true);
    expect(url).toContain(encodeURIComponent(target));
    expect(url).toContain(`ref=${encodeURIComponent(ref)}`);
  });
});

describe('startDappBrowserHandoff', () => {
  const originalNav = globalThis.navigator;
  const originalWindow = globalThis.window;

  function stubUa(ua: string): void {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: ua } as Navigator,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        navigator: { userAgent: ua },
        location: { origin: 'https://test.vizzor.ai' },
      } as unknown as Window & typeof globalThis,
    });
  }

  afterEach(() => {
    if (originalNav) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNav,
      });
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it('emits both iOS scheme + Android intent URLs and detects iOS', () => {
    stubUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
    const kickoff = startDappBrowserHandoff({
      providerId: 'phantom',
      targetUrl: 'https://test.vizzor.ai/en/predict',
    });
    expect(kickoff.platform).toBe('ios');
    expect(kickoff.iosUrl.startsWith('phantom://browse/')).toBe(true);
    expect(kickoff.androidIntentUrl.startsWith('intent://')).toBe(true);
    expect(kickoff.fallbackInstallUrl).toBe('https://phantom.app/download');
    // The auto-connect contract decoration must be present in BOTH URLs.
    expect(kickoff.iosUrl).toContain(encodeURIComponent('action=connect'));
    expect(kickoff.iosUrl).toContain(encodeURIComponent('provider=phantom'));
    expect(kickoff.androidIntentUrl).toContain(
      encodeURIComponent('action=connect'),
    );
  });

  it('detects Android UA + carries the Play-Store fallback', () => {
    stubUa('Mozilla/5.0 (Linux; Android 14; Pixel 8)');
    const kickoff = startDappBrowserHandoff({
      providerId: 'solflare',
      targetUrl: 'https://test.vizzor.ai/en/predict',
    });
    expect(kickoff.platform).toBe('android');
    expect(kickoff.androidIntentUrl).toContain('package=com.solflare.mobile');
    expect(kickoff.androidIntentUrl).toContain(
      encodeURIComponent('https://solflare.com/download'),
    );
  });
});

describe('isMobileWeb / isWalletBrowser', () => {
  const originalNav = globalThis.navigator;

  function stubUa(ua: string): void {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: ua } as Navigator,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { navigator: { userAgent: ua } } as Window & typeof globalThis,
    });
  }

  afterEach(() => {
    if (originalNav) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNav,
      });
    }
  });

  it('returns false for desktop UAs', () => {
    stubUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit');
    expect(isMobileWeb()).toBe(false);
    expect(isWalletBrowser()).toBe(false);
  });

  it('returns true for plain iOS Safari (mobile, not wallet)', () => {
    stubUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari');
    expect(isMobileWeb()).toBe(true);
    expect(isWalletBrowser()).toBe(false);
  });

  it('flips when running inside a wallet in-app browser', () => {
    stubUa('Mozilla/5.0 (iPhone) Phantom/1.0');
    // Mobile UA + wallet UA → isMobileWeb FALSE (we want the dapp to
    // use the desktop flow there), isWalletBrowser TRUE.
    expect(isMobileWeb()).toBe(false);
    expect(isWalletBrowser()).toBe(true);
  });
});
