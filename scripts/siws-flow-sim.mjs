/**
 * Auto-test for the SIWS connect flow against the live dev server.
 * Simulates what Phantom does on the new Wallet Standard signIn path
 * — without needing a real wallet UI confirmation.
 *
 *   Run: node scripts/siws-flow-sim.mjs
 *   Expects dev server at http://localhost:3000.
 *
 * Branches covered:
 *   A. signIn path  — POSTs `signedMessage` (b64) + `signature` (b58)
 *   B. signMessage  — legacy path, no signedMessage in body
 *   C. tamper       — signedMessage mutated post-signing, must reject
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';

const BASE = 'http://localhost:3000';

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function fetchNonce(wallet) {
  const res = await fetch(`${BASE}/api/auth/siws/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ wallet, action: 'login' }),
  });
  const cookie =
    (res.headers.get('set-cookie') ?? '').match(/vizzor\.siws\.nonce=[^;]+/)?.[0] ?? '';
  const json = await res.json();
  return { cookie, json };
}

async function postVerify(body, cookie) {
  const res = await fetch(`${BASE}/api/auth/siws/verify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      cookie,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json(), setCookie: res.headers.get('set-cookie') ?? '' };
}

// ── A. signIn path ───────────────────────────────────────────────
const a = nacl.sign.keyPair();
const aWallet = bs58.encode(a.publicKey);
const aNonce = await fetchNonce(aWallet);
const aBytes = new TextEncoder().encode(aNonce.json.message);
const aSig = nacl.sign.detached(aBytes, a.secretKey);
const aVerify = await postVerify(
  {
    wallet: aWallet,
    signature: bs58.encode(aSig),
    signedMessage: b64(aBytes),
    action: 'login',
    issuedAt: aNonce.json.issuedAt,
    expiresAt: aNonce.json.expiresAt,
  },
  aNonce.cookie,
);
console.log('[A] signIn  path :', aVerify.json, '   authCookie?',
  /vizzor\.auth=|__Host-vizzor\.auth=/.test(aVerify.setCookie));

// ── B. legacy signMessage path ───────────────────────────────────
const b = nacl.sign.keyPair();
const bWallet = bs58.encode(b.publicKey);
const bNonce = await fetchNonce(bWallet);
const bBytes = new TextEncoder().encode(bNonce.json.message);
const bSig = nacl.sign.detached(bBytes, b.secretKey);
const bVerify = await postVerify(
  {
    wallet: bWallet,
    signature: bs58.encode(bSig),
    action: 'login',
    issuedAt: bNonce.json.issuedAt,
    expiresAt: bNonce.json.expiresAt,
  },
  bNonce.cookie,
);
console.log('[B] signMsg path :', bVerify.json);

// ── C. tampered signedMessage ────────────────────────────────────
const c = nacl.sign.keyPair();
const cWallet = bs58.encode(c.publicKey);
const cNonce = await fetchNonce(cWallet);
const cGood = new TextEncoder().encode(cNonce.json.message);
const cTampered = new TextEncoder().encode(
  cNonce.json.message.replace(
    'Authenticate this wallet to start your Vizzor session.',
    'Link this wallet to your Vizzor account.',
  ),
);
const cSig = nacl.sign.detached(cGood, c.secretKey);
const cVerify = await postVerify(
  {
    wallet: cWallet,
    signature: bs58.encode(cSig),
    signedMessage: b64(cTampered),
    action: 'login',
    issuedAt: cNonce.json.issuedAt,
    expiresAt: cNonce.json.expiresAt,
  },
  cNonce.cookie,
);
console.log('[C] tampered    :', cVerify.json);

// ── verdict ──────────────────────────────────────────────────────
const passA = aVerify.json.ok === true;
const passB = bVerify.json.ok === true;
const passC = cVerify.json.ok === false;
console.log('\n=== verdict ===');
console.log(' A signIn-path  accepts genuine bytes :', passA ? 'PASS' : 'FAIL');
console.log(' B signMessage  legacy path still ok  :', passB ? 'PASS' : 'FAIL');
console.log(' C tampered     bytes rejected        :', passC ? 'PASS' : 'FAIL');

process.exit(passA && passB && passC ? 0 : 1);
