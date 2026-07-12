/**
 * Socket.IO event catalog (Technical Spec §9). Both apps import these names so
 * a typo can never split the contract; payload types join them milestone by
 * milestone as each event is implemented.
 */
export const CLIENT_EVENTS = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_ACK: 'message:ack',
  /** Reconnect gap-replay: last known sequence per conversation (§21.2). */
  MESSAGE_SYNC: 'message:sync',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  PRESENCE_HEARTBEAT: 'presence:heartbeat',
  /** Bidirectional relay — carries both 1:1 call and live-mesh SDP/ICE (§9, §11). */
  CALL_OFFER: 'call:offer',
  CALL_ANSWER: 'call:answer',
  CALL_ICE_CANDIDATE: 'call:ice-candidate',
  /** 1:1 call lifecycle (§14.4). */
  CALL_INVITE: 'call:invite',
  CALL_ACCEPT: 'call:accept',
  CALL_REJECT: 'call:reject',
  CALL_END: 'call:end',
  /** Live-mesh viewer join/leave (§12). */
  LIVE_JOIN: 'live:join',
  LIVE_LEAVE: 'live:leave',
} as const;

export const SERVER_EVENTS = {
  MESSAGE_NEW: 'message:new',
  MESSAGE_EDITED: 'message:edited',
  MESSAGE_DELETED: 'message:deleted',
  /** A reaction was added, replaced, or removed (§14.4). */
  MESSAGE_REACTION: 'message:reaction',
  MESSAGE_STATUS: 'message:status',
  /** Relays a member's typing:start/stop to the rest of the conversation. */
  TYPING_UPDATE: 'typing:update',
  PRESENCE_UPDATE: 'presence:update',
  NOTIFICATION_NEW: 'notification:new',
  /** No payload — a "refetch" ping, mirrors client-side query invalidation (§12.2). */
  ACTIVE_COUNT_UPDATE: 'active-count:update',
  CALL_INCOMING: 'call:incoming',
  CALL_ACCEPTED: 'call:accepted',
  CALL_REJECTED: 'call:rejected',
  CALL_ENDED: 'call:ended',
  LIVE_STARTED: 'live:started',
  LIVE_ENDED: 'live:ended',
  LIVE_VIEWER_JOINED: 'live:viewer-joined',
  LIVE_VIEWER_LEFT: 'live:viewer-left',
} as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];
export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];
