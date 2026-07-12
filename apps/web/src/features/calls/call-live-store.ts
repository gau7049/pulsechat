import type { UserSummaryDto } from '@pulsechat/shared';

/**
 * Ephemeral 1:1 call state (Requirement Scope §14.4) — outside React Query,
 * same pattern as `chat-live-store.ts`: it's never fetched or cached, just
 * driven live by socket events.
 */

export type CallState =
  | { status: 'idle' }
  | {
      status: 'ringing-outgoing';
      callId: string;
      otherUser: UserSummaryDto;
      kind: 'audio' | 'video';
    }
  | {
      status: 'ringing-incoming';
      callId: string;
      otherUser: UserSummaryDto;
      kind: 'audio' | 'video';
    }
  | {
      status: 'in-call';
      callId: string;
      otherUser: UserSummaryDto;
      kind: 'audio' | 'video';
      localStream: MediaStream | null;
      remoteStream: MediaStream | null;
    };

let state: CallState = { status: 'idle' };
const listeners = new Set<() => void>();

export function getCallState(): CallState {
  return state;
}

export function setCallState(next: CallState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeCallState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
