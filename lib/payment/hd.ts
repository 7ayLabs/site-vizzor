/**
 * HD address derivation — per-session deterministic addresses for the
 * Vizzor treasury.
 *
 * v0.1.0 ships a single fixed treasury address per chain
 * (`lib/payment/treasury.ts`). v0.2.0 derives per-session addresses
 * from a single BIP-39 mnemonic stashed in `VIZZOR_TREASURY_MNEMONIC`
 * so the watcher can disambiguate concurrent sessions without relying
 * solely on the memo field, and so on-chain analytics never see the
 * same destination address twice in a row.
 *
 * Derivation paths:
 *   Solana — m/44'/501'/<index>'/0'  (SLIP-0010 ed25519, SLIP-0044 coin
 *                                       type 501; same path Phantom and
 *                                       Solflare use for their default
 *                                       account)
 *   TON    — m/44'/607'/<index>'     (SLIP-0010 ed25519, SLIP-0044 coin
 *                                       type 607; matches Tonkeeper)
 *
 * Crypto stack:
 *   - BIP-39 mnemonic → seed via `@scure/bip39` (mnemonicToSeedSync).
 *   - SLIP-0010 ed25519 derivation via `@ton/crypto.deriveEd25519Path`.
 *   - Solana base58 address encoding via `@solana/web3.js.Keypair`.
 *   - TON friendly address via `@ton/ton.WalletContractV4`.
 *
 * Failure mode contract:
 *   - Invalid or unset mnemonic THROWS a typed error. The caller
 *     (`createSession`) is responsible for catching, logging at warn
 *     level (NEVER logging mnemonic content), and falling back to the
 *     fixed treasury address. This is the security floor — an invalid
 *     mnemonic must not yield an arbitrary fallback address from inside
 *     this module.
 *   - All imports are dynamic so this module's cost is zero on code
 *     paths that never enable HD derivation.
 */

const SOLANA_COIN_TYPE = 501;
const TON_COIN_TYPE = 607;
/** BIP-32 hardened-key offset, restated here so we can build paths
 *  without depending on an upstream constant export. */
const HARDENED_OFFSET = 0x80000000;

export class HdDerivationError extends Error {
  constructor(
    message: string,
    /** Stable machine-readable code for the failure mode. */
    public readonly code:
      | 'mnemonic_missing'
      | 'mnemonic_invalid'
      | 'derivation_failed',
  ) {
    super(message);
    this.name = 'HdDerivationError';
  }
}

export interface SolanaDerivedKey {
  /** base58-encoded ed25519 public key (Solana wallet address). */
  publicKey: string;
  /**
   * 32-byte ed25519 seed (the SLIP-0010 derived secret, NOT the
   * 64-byte expanded private key). Server-only. Callers MUST zero
   * this buffer after use.
   */
  privateKeyBytes: Uint8Array;
}

export interface TonDerivedKey {
  /** EQ.../UQ...-style base64url TON friendly address. */
  friendlyAddress: string;
}

/**
 * Derive the Solana address for a given session index.
 *
 * The function is deterministic: identical (masterMnemonic, sessionIndex)
 * yields a byte-identical (publicKey, privateKeyBytes) pair on every
 * call across processes, hosts, and Node versions. This is the basis
 * for the test stub in `tests/payment/hd.test.ts`.
 *
 * @throws HdDerivationError when the mnemonic is empty or fails BIP-39
 *   validation, or when the derivation library itself rejects the path.
 */
export async function deriveSolanaAddress(
  masterMnemonic: string,
  sessionIndex: number,
): Promise<SolanaDerivedKey> {
  assertMnemonic(masterMnemonic);
  assertIndex(sessionIndex);

  const seed = await mnemonicToSeed(masterMnemonic);
  // m/44'/501'/<index>'/0' — all four levels hardened.
  const path = [
    44 + HARDENED_OFFSET,
    SOLANA_COIN_TYPE + HARDENED_OFFSET,
    sessionIndex + HARDENED_OFFSET,
    0 + HARDENED_OFFSET,
  ];

  let derivedSeed: Uint8Array;
  try {
    const ton = await import('@ton/crypto');
    // `deriveEd25519Path` returns a 32-byte seed that we feed into
    // Solana's `Keypair.fromSeed`, which expands it into the 64-byte
    // ed25519 keypair canonical Solana wallets use.
    const buf = await ton.deriveEd25519Path(Buffer.from(seed), path);
    derivedSeed = new Uint8Array(buf);
  } catch (e) {
    throw new HdDerivationError(
      `solana derivation failed: ${(e as Error).message}`,
      'derivation_failed',
    );
  }

  // Lazy-load @solana/web3.js to keep this module's eager cost zero.
  const web3 = await import('@solana/web3.js');
  const kp = web3.Keypair.fromSeed(derivedSeed);
  return {
    publicKey: kp.publicKey.toBase58(),
    privateKeyBytes: derivedSeed,
  };
}

/**
 * Derive the TON friendly address for a given session index.
 *
 * Determinism contract matches `deriveSolanaAddress`. The friendly
 * address is what the user's wallet displays and is the form we
 * persist in `payment_sessions.dest_address`.
 *
 * @throws HdDerivationError when the mnemonic is invalid or the
 *   derivation library rejects the path.
 */
export async function deriveTonAddress(
  masterMnemonic: string,
  sessionIndex: number,
): Promise<TonDerivedKey> {
  assertMnemonic(masterMnemonic);
  assertIndex(sessionIndex);

  const seed = await mnemonicToSeed(masterMnemonic);
  // m/44'/607'/<index>' — three hardened levels per Tonkeeper convention.
  const path = [
    44 + HARDENED_OFFSET,
    TON_COIN_TYPE + HARDENED_OFFSET,
    sessionIndex + HARDENED_OFFSET,
  ];

  let derivedSeed: Buffer;
  try {
    const ton = await import('@ton/crypto');
    derivedSeed = await ton.deriveEd25519Path(Buffer.from(seed), path);
  } catch (e) {
    throw new HdDerivationError(
      `ton derivation failed: ${(e as Error).message}`,
      'derivation_failed',
    );
  }

  let friendlyAddress: string;
  try {
    const tonCrypto = await import('@ton/crypto');
    const tonSdk = await import('@ton/ton');
    // keyPairFromSeed expands the 32-byte seed into an ed25519 keypair;
    // the wallet contract derivation only needs the publicKey buffer.
    const kp = tonCrypto.keyPairFromSeed(derivedSeed);
    const wallet = tonSdk.WalletContractV4.create({
      workchain: 0,
      publicKey: kp.publicKey,
    });
    // bounceable=false matches the user-wallet convention for
    // receiving addresses (UQ...). urlSafe=true gives the base64url
    // form that's safe to embed in tonkeeper:// deep links.
    friendlyAddress = wallet.address.toString({
      urlSafe: true,
      bounceable: false,
    });
  } catch (e) {
    throw new HdDerivationError(
      `ton address encoding failed: ${(e as Error).message}`,
      'derivation_failed',
    );
  }

  return { friendlyAddress };
}

/* ------------------------------------------------------------------ *\
 * Helpers
\* ------------------------------------------------------------------ */

function assertMnemonic(m: string): void {
  if (typeof m !== 'string' || m.trim().length === 0) {
    throw new HdDerivationError('mnemonic is missing', 'mnemonic_missing');
  }
  // BIP-39 mnemonics are 12 or 24 words separated by single spaces.
  const words = m.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    throw new HdDerivationError(
      `mnemonic must be 12 or 24 words (got ${words.length})`,
      'mnemonic_invalid',
    );
  }
}

function assertIndex(i: number): void {
  if (!Number.isInteger(i) || i < 0 || i > 2_147_483_647) {
    throw new HdDerivationError(
      `derivation index must be a non-negative 31-bit integer (got ${i})`,
      'derivation_failed',
    );
  }
}

async function mnemonicToSeed(mnemonic: string): Promise<Uint8Array> {
  let bip39: typeof import('@scure/bip39');
  let wordlistMod: typeof import('@scure/bip39/wordlists/english.js');
  try {
    bip39 = await import('@scure/bip39');
    wordlistMod = await import('@scure/bip39/wordlists/english.js');
  } catch (e) {
    throw new HdDerivationError(
      `bip39 library unavailable: ${(e as Error).message}`,
      'derivation_failed',
    );
  }

  const normalized = mnemonic.trim().toLowerCase();
  if (!bip39.validateMnemonic(normalized, wordlistMod.wordlist)) {
    throw new HdDerivationError(
      'mnemonic fails BIP-39 checksum validation',
      'mnemonic_invalid',
    );
  }
  return bip39.mnemonicToSeedSync(normalized);
}
