import { useEffect, useState } from 'react';
import type { ConversationDto } from '@pulsechat/shared';
import { decryptMessage } from '../../lib/crypto/conversation-keys';
import { getConversationKey, KeysLockedError } from './chat-keys';

/**
 * Decrypts one message body for display (Technical Spec §6). Results are
 * memoized per message id — history scrolling never re-runs AES.
 */

const cache = new Map<string, string | null>();

export type DecryptState =
  | { state: 'loading' }
  | { state: 'ok'; text: string }
  | { state: 'locked' }
  | { state: 'unreadable' };

export function useDecryptedMessage(
  userId: string,
  conversation: ConversationDto,
  message: { id: string; ciphertext: string; nonce: string } | null,
): DecryptState {
  const [result, setResult] = useState<DecryptState>(() => {
    const cached = message ? cache.get(message.id) : undefined;
    if (cached !== undefined) {
      return cached === null ? { state: 'unreadable' } : { state: 'ok', text: cached };
    }
    return { state: 'loading' };
  });

  useEffect(() => {
    if (!message) return;
    const cached = cache.get(message.id);
    if (cached !== undefined) {
      setResult(cached === null ? { state: 'unreadable' } : { state: 'ok', text: cached });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const key = await getConversationKey(userId, conversation);
        if (!key) {
          if (!cancelled) setResult({ state: 'unreadable' });
          return;
        }
        const text = await decryptMessage(key, message.ciphertext, message.nonce);
        cache.set(message.id, text);
        if (!cancelled) {
          setResult(text === null ? { state: 'unreadable' } : { state: 'ok', text });
        }
      } catch (error) {
        if (!cancelled) {
          setResult(
            error instanceof KeysLockedError ? { state: 'locked' } : { state: 'unreadable' },
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, conversation, message]);

  return message ? result : { state: 'loading' };
}
