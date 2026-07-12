/**
 * The plaintext structure inside every message ciphertext. The server never
 * sees this — it exists purely between clients (Technical Spec §6), so it can
 * evolve without API changes. Legacy M3 messages were bare text; parsing
 * falls back to that.
 */

export interface AttachmentMeta {
  url: string;
  name: string;
  /** Bytes, as uploaded (≤ 10 MB, §14.8). */
  size: number;
  mimeType: string;
}

export type MessageEnvelope =
  | { v: 1; type: 'text'; text: string }
  | { v: 1; type: 'sticker'; emoji: string }
  | {
      v: 1;
      type: 'image' | 'video' | 'audio' | 'document';
      attachment: AttachmentMeta;
      /** Optional caption. */
      text?: string;
    };

export function serializeEnvelope(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}

export function parseEnvelope(plaintext: string): MessageEnvelope {
  try {
    const parsed = JSON.parse(plaintext) as MessageEnvelope;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.v === 1 &&
      ['text', 'sticker', 'image', 'video', 'audio', 'document'].includes(parsed.type)
    ) {
      return parsed;
    }
  } catch {
    // Not JSON — a legacy plain-text message.
  }
  return { v: 1, type: 'text', text: plaintext };
}

/** §14.4 big single emoji: one emoji (possibly composed) and nothing else. */
export function isSingleEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 16) return false;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)];
  return segments.length === 1 && /\p{Extended_Pictographic}/u.test(trimmed);
}
