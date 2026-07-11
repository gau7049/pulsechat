// Sumo build: the standard build omits crypto_pwhash (Argon2id), which the
// password-derived key wrapping requires.
import sodium from 'libsodium-wrappers-sumo';
import { idbGet, idbPut } from '../idb.js';

/**
 * Client-side keypair management (Technical Spec §6): an X25519 keypair is
 * generated in-browser at signup. The private key never leaves this device —
 * it is encrypted with a key derived from the user's password (Argon2id via
 * libsodium's crypto_pwhash) and stored in IndexedDB. Only the public key is
 * sent to the server.
 */

interface StoredKeyRecord {
  publicKey: string; // base64
  encryptedPrivateKey: string; // base64(nonce ‖ ciphertext)
  kdfSalt: string; // base64
}

function recordKey(userId: string): string {
  return `keypair:${userId}`;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

/**
 * Generates the account keypair, encrypts the private half with the password,
 * persists locally keyed by a temporary id (rekeyed to the real user id right
 * after registration), and returns the public key for the register call.
 */
export async function generateKeypair(password: string): Promise<{
  publicKey: string;
  /** Raw private key — seed the session cache so chats work immediately. */
  privateKey: Uint8Array;
  store: (userId: string) => Promise<void>;
}> {
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = await deriveKey(password, salt);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const sealed = sodium.crypto_secretbox_easy(pair.privateKey, nonce, key);

  const combined = new Uint8Array(nonce.length + sealed.length);
  combined.set(nonce);
  combined.set(sealed, nonce.length);

  const record: StoredKeyRecord = {
    publicKey: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL),
    encryptedPrivateKey: sodium.to_base64(combined, sodium.base64_variants.ORIGINAL),
    kdfSalt: sodium.to_base64(salt, sodium.base64_variants.ORIGINAL),
  };

  return {
    publicKey: record.publicKey,
    privateKey: pair.privateKey,
    store: (userId: string) => idbPut(recordKey(userId), record),
  };
}

/**
 * Decrypts the locally stored private key with the password. Returns null when
 * no key exists on this device (fresh browser) or the password is wrong —
 * callers decide how to surface the §6 trade-off.
 */
export async function unlockPrivateKey(
  userId: string,
  password: string,
): Promise<Uint8Array | null> {
  await sodium.ready;
  const record = await idbGet<StoredKeyRecord>(recordKey(userId));
  if (!record) return null;
  try {
    const salt = sodium.from_base64(record.kdfSalt, sodium.base64_variants.ORIGINAL);
    const combined = sodium.from_base64(
      record.encryptedPrivateKey,
      sodium.base64_variants.ORIGINAL,
    );
    const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
    const sealed = combined.slice(sodium.crypto_secretbox_NONCEBYTES);
    const key = await deriveKey(password, salt);
    return sodium.crypto_secretbox_open_easy(sealed, nonce, key);
  } catch {
    return null;
  }
}

/** Whether this device holds a private key for the user. */
export async function hasLocalKeypair(userId: string): Promise<boolean> {
  return (await idbGet(recordKey(userId))) !== undefined;
}
