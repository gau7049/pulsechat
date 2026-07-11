import { idbDelete, idbGet, idbPut } from '../idb.js';

/**
 * Session cache of the unlocked account private key. The durable record stays
 * password-wrapped (keys.ts, Technical Spec §6); this cache exists so a page
 * reload with a silently-restored session can still decrypt conversations.
 * Cleared on logout. Trade-off: the raw key rests on this device while a
 * session is active — the §6/§20 threat model is the server, not this device.
 */

let inMemory: { userId: string; privateKey: Uint8Array } | null = null;

function sessionRecordKey(userId: string): string {
  return `session-key:${userId}`;
}

export async function saveSessionKey(userId: string, privateKey: Uint8Array): Promise<void> {
  inMemory = { userId, privateKey };
  await idbPut(sessionRecordKey(userId), Array.from(privateKey));
}

export async function loadSessionKey(userId: string): Promise<Uint8Array | null> {
  if (inMemory?.userId === userId) return inMemory.privateKey;
  const stored = await idbGet<number[]>(sessionRecordKey(userId));
  if (!stored) return null;
  const key = new Uint8Array(stored);
  inMemory = { userId, privateKey: key };
  return key;
}

export async function clearSessionKey(userId: string): Promise<void> {
  if (inMemory?.userId === userId) inMemory = null;
  await idbDelete(sessionRecordKey(userId));
}
