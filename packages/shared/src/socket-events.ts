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
  CALL_OFFER: 'call:offer',
  CALL_ANSWER: 'call:answer',
  CALL_ICE_CANDIDATE: 'call:ice-candidate',
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
  ACTIVE_COUNT_UPDATE: 'active-count:update',
} as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];
export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];
