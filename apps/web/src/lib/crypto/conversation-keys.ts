import sodium from 'libsodium-wrappers-sumo';

/**
 * Conversation content-key crypto (Technical Spec §6): one AES-256-GCM key per
 * conversation, generated client-side, sealed to each member's X25519 public
 * key with a libsodium sealed box. Message bodies are AES-GCM via WebCrypto.
 */

const B64 = () => sodium.base64_variants.ORIGINAL;

export async function generateContentKey(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(32);
}

/** Seals the content key to one member's public key → their wrapped_key. */
export async function wrapKeyFor(publicKeyB64: string, contentKey: Uint8Array): Promise<string> {
  await sodium.ready;
  const publicKey = sodium.from_base64(publicKeyB64, B64());
  return sodium.to_base64(sodium.crypto_box_seal(contentKey, publicKey), B64());
}

/** Opens the viewer's own wrapped_key with their account keypair. */
export async function unwrapKey(
  wrappedKeyB64: string,
  privateKey: Uint8Array,
): Promise<Uint8Array | null> {
  await sodium.ready;
  try {
    const publicKey = sodium.crypto_scalarmult_base(privateKey);
    const wrapped = sodium.from_base64(wrappedKeyB64, B64());
    return sodium.crypto_box_seal_open(wrapped, publicKey, privateKey);
  } catch {
    return null;
  }
}

async function importAesKey(contentKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', contentKey as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function encryptMessage(
  contentKey: Uint8Array,
  plaintext: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const key = await importAesKey(contentKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toBase64(new Uint8Array(encrypted)), nonce: toBase64(iv) };
}

/** Null on any failure — the UI renders an "undecryptable" placeholder. */
export async function decryptMessage(
  contentKey: Uint8Array,
  ciphertext: string,
  nonce: string,
): Promise<string | null> {
  try {
    const key = await importAesKey(contentKey);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(nonce) as BufferSource },
      key,
      fromBase64(ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
