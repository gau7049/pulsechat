import { useCallback, useEffect, useState } from 'react';
import type { ConversationDto, MeDto } from '@pulsechat/shared';
import { patch } from '../../lib/api';
import { generateKeypair, hasLocalKeypair, unlockPrivateKey } from '../../lib/crypto/keys';
import { loadSessionKey, saveSessionKey } from '../../lib/crypto/key-session';
import { unwrapKey } from '../../lib/crypto/conversation-keys';

/**
 * Conversation content keys, unwrapped once per conversation and cached for
 * the session (Technical Spec §6). Also tracks whether this device can
 * decrypt at all: the private key may need a password unlock (magic-link
 * sign-in) or may simply not exist here (fresh browser — §6 trade-off).
 */

const contentKeys = new Map<string, Uint8Array>();

export class KeysLockedError extends Error {
  constructor() {
    super('Encryption keys are locked on this device');
    this.name = 'KeysLockedError';
  }
}

export async function getConversationKey(
  userId: string,
  conversation: Pick<ConversationDto, 'id' | 'myWrappedKey'>,
): Promise<Uint8Array | null> {
  const cached = contentKeys.get(conversation.id);
  if (cached) return cached;
  const privateKey = await loadSessionKey(userId);
  if (!privateKey) throw new KeysLockedError();
  const key = await unwrapKey(conversation.myWrappedKey, privateKey);
  if (key) contentKeys.set(conversation.id, key);
  return key;
}

export type KeyStatus = 'checking' | 'ready' | 'locked' | 'missing';

const listeners = new Set<() => void>();

/** Re-checks key status in every mounted `useKeyStatus` consumer. */
export function notifyKeyChange(): void {
  for (const listener of listeners) listener();
}

/** Where this device stands on decryption, plus a password unlock action. */
export function useKeyStatus(userId: string | undefined) {
  const [status, setStatus] = useState<KeyStatus>('checking');

  const refresh = useCallback(async () => {
    if (!userId) return;
    if (await loadSessionKey(userId)) {
      setStatus('ready');
    } else if (await hasLocalKeypair(userId)) {
      setStatus('locked');
    } else {
      setStatus('missing');
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [refresh]);

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      if (!userId) return false;
      const privateKey = await unlockPrivateKey(userId, password);
      if (!privateKey) return false;
      await saveSessionKey(userId, privateKey);
      notifyKeyChange();
      return true;
    },
    [userId],
  );

  /**
   * For the 'missing' state: generates a brand-new keypair on this device and
   * registers it as the account's public key, so it can start new
   * conversations again. Existing conversations stay unreadable here — their
   * wrapped keys were sealed to the key that was lost, and nothing rewraps
   * them (see conversation-keys.ts's forward-secrecy comment for the same
   * class of trade-off).
   */
  const recover = useCallback(
    async (password: string): Promise<{ ok: true; user: MeDto } | { ok: false; error: string }> => {
      if (!userId) return { ok: false, error: 'Not signed in' };
      try {
        const keypair = await generateKeypair(password);
        const { user } = await patch<{ user: MeDto }>('/account/encryption-key', {
          currentPassword: password,
          publicKey: keypair.publicKey,
        });
        await keypair.store(userId);
        await saveSessionKey(userId, keypair.privateKey);
        notifyKeyChange();
        return { ok: true, user };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Could not set up encryption on this device',
        };
      }
    },
    [userId],
  );

  return { status, unlock, recover };
}
