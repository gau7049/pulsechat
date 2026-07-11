/**
 * Client-side offline queue (Requirement Scope §21.2): messages composed while
 * disconnected (or that failed mid-flight) wait here — already encrypted — and
 * auto-retry on reconnect. Persisted so a tab reload doesn't drop them.
 */

export interface OutboxEntry {
  clientUuid: string;
  conversationId: string;
  ciphertext: string;
  nonce: string;
  createdAt: string;
  status: 'pending' | 'failed';
}

const STORAGE_KEY = 'pulsechat:outbox';
const listeners = new Set<() => void>();
let entries: OutboxEntry[] = load();

function load(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full/blocked — the queue still works in-memory for this tab.
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEntries(): OutboxEntry[] {
  return entries;
}

export function enqueue(entry: Omit<OutboxEntry, 'status'>): void {
  entries = [...entries, { ...entry, status: 'pending' }];
  persist();
}

export function markFailed(clientUuid: string): void {
  entries = entries.map((e) => (e.clientUuid === clientUuid ? { ...e, status: 'failed' } : e));
  persist();
}

export function markPending(clientUuid: string): void {
  entries = entries.map((e) => (e.clientUuid === clientUuid ? { ...e, status: 'pending' } : e));
  persist();
}

export function remove(clientUuid: string): void {
  entries = entries.filter((e) => e.clientUuid !== clientUuid);
  persist();
}

export function pendingEntries(): OutboxEntry[] {
  return entries.filter((e) => e.status === 'pending');
}
