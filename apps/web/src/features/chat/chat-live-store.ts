/**
 * Tiny in-memory stores for ephemeral live chat state — typing indicators and
 * per-recipient ack watermarks — fed by socket events, read via
 * useSyncExternalStore. Deliberately outside React Query: this state is
 * transient and never refetched.
 */

type Listener = () => void;

function makeEmitter() {
  const listeners = new Set<Listener>();
  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(): void {
      for (const listener of listeners) listener();
    },
  };
}

// ── Typing (§14.10) ──────────────────────────────────────────────────────────

interface TypingUser {
  userId: string;
  displayName: string;
  expiresAt: number;
}

const typingByConversation = new Map<string, Map<string, TypingUser>>();
export const typingEmitter = makeEmitter();
/** Snapshot cache so getSnapshot stays referentially stable between events. */
const typingSnapshots = new Map<string, TypingUser[]>();

export function setTyping(
  conversationId: string,
  user: { userId: string; displayName: string },
  typing: boolean,
): void {
  const map = typingByConversation.get(conversationId) ?? new Map<string, TypingUser>();
  if (typing) {
    map.set(user.userId, { ...user, expiresAt: Date.now() + 6000 });
    // Safety expiry in case typing:stop never arrives.
    setTimeout(() => {
      const current = typingByConversation.get(conversationId)?.get(user.userId);
      if (current && current.expiresAt <= Date.now()) {
        typingByConversation.get(conversationId)?.delete(user.userId);
        typingSnapshots.delete(conversationId);
        typingEmitter.emit();
      }
    }, 6100);
  } else {
    map.delete(user.userId);
  }
  typingByConversation.set(conversationId, map);
  typingSnapshots.delete(conversationId);
  typingEmitter.emit();
}

export function getTypingSnapshot(conversationId: string): TypingUser[] {
  let snapshot = typingSnapshots.get(conversationId);
  if (!snapshot) {
    snapshot = [...(typingByConversation.get(conversationId)?.values() ?? [])];
    typingSnapshots.set(conversationId, snapshot);
  }
  return snapshot;
}

// ── Live ack watermarks (§14.1 ticks, updated by message:status) ─────────────

interface AckWatermark {
  delivered: number;
  read: number;
}

const acksByConversation = new Map<string, Map<string, AckWatermark>>();
export const ackEmitter = makeEmitter();
let ackVersion = 0;

export function recordAck(
  conversationId: string,
  userId: string,
  state: 'notified' | 'delivered' | 'read',
  upToSequence: number,
): void {
  const map = acksByConversation.get(conversationId) ?? new Map<string, AckWatermark>();
  const current = map.get(userId) ?? { delivered: 0, read: 0 };
  const next = { ...current };
  if (state !== 'notified') next.delivered = Math.max(next.delivered, upToSequence);
  if (state === 'read') next.read = Math.max(next.read, upToSequence);
  map.set(userId, next);
  acksByConversation.set(conversationId, map);
  ackVersion += 1;
  ackEmitter.emit();
}

export function getAckVersion(): number {
  return ackVersion;
}

/**
 * Live aggregate for one of the viewer's messages: have all recipients
 * acknowledged past this sequence? Used to upgrade the server-reported state
 * without refetching.
 */
export function liveAggregate(
  conversationId: string,
  sequence: number,
  recipientIds: string[],
): 'delivered' | 'read' | null {
  if (recipientIds.length === 0) return null;
  const map = acksByConversation.get(conversationId);
  if (!map) return null;
  let allDelivered = true;
  let allRead = true;
  for (const id of recipientIds) {
    const mark = map.get(id);
    if (!mark || mark.delivered < sequence) allDelivered = false;
    if (!mark || mark.read < sequence) allRead = false;
  }
  if (allRead) return 'read';
  if (allDelivered) return 'delivered';
  return null;
}

// ── Which conversation is on screen (drives read acks + unread badges) ───────

let activeConversationId: string | null = null;

export function setActiveConversation(id: string | null): void {
  activeConversationId = id;
}

export function getActiveConversation(): string | null {
  return activeConversationId;
}
