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

/** A denormalized snapshot so the bubble renders without an extra fetch (§13.6). */
export interface PostSharePreview {
  postId: string;
  /** Nullable since §24.1 — a text-only post has no media. */
  mediaUrl: string | null;
  caption: string | null;
  authorUsername: string;
  authorDisplayName: string;
}

/** §24.10 story replies — reuses the encrypted chat pipeline, same as `post-share`. */
export interface StoryReplyPreview {
  statusId: string;
  mediaUrl: string | null;
  caption: string | null;
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
    }
  | { v: 1; type: 'post-share'; post: PostSharePreview }
  | { v: 1; type: 'story-reply'; story: StoryReplyPreview; text: string };

export function serializeEnvelope(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}

const ENVELOPE_TYPES = [
  'text',
  'sticker',
  'image',
  'video',
  'audio',
  'document',
  'post-share',
  'story-reply',
];

export function parseEnvelope(plaintext: string): MessageEnvelope {
  try {
    const parsed = JSON.parse(plaintext) as MessageEnvelope;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.v === 1 &&
      ENVELOPE_TYPES.includes(parsed.type)
    ) {
      // Defends against a message whose plaintext ended up as an envelope
      // JSON string wrapped a second time inside a `type: 'text'` shell
      // (e.g. from an older client bug, or a message re-sent through a path
      // that already serialized it) — unwrap rather than showing raw JSON.
      if (parsed.type === 'text' && parsed.text.startsWith('{"v":1,"type":"')) {
        return parseEnvelope(parsed.text);
      }
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
