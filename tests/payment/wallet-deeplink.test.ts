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

import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  buildConnectUrl,
  buildSignMessageUrl,
  decryptConnectCallback,
  decryptSignMessageCallback,
  encodeSignMessagePayload,
  generateDappKeypair,
} from '@/lib/wallet/deeplink';

describe('buildConnectUrl', () => {
  it('targets phantom.app and carries every required param', () => {
    const url = new URL(
      buildConnectUrl({
        providerId: 'phantom',
        dappPublicKey: 'A'.repeat(43),
        redirectLink: 'https://vizzor.ai/wallet/callback?step=connect',
        cluster: 'mainnet-beta',
        appUrl: 'https://vizzor.ai',
      }),
    );
    expect(url.origin).toBe('https://phantom.app');
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
