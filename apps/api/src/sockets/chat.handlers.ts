import type { Socket } from 'socket.io';
import type { ZodTypeAny, z } from 'zod';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  messageAckSchema,
  messageSendSchema,
  messageSyncSchema,
  typingSchema,
  type MessageSendAck,
  type MessageSyncAck,
  type TypingEventPayload,
} from '@pulsechat/shared';
import { AppError } from '../http/errors.js';
import { getIo } from '../lib/io.js';
import { logger } from '../lib/logger.js';
import { ackMessages, sendMessage, syncMessages } from '../services/chat.service.js';
import * as chat from '../repositories/chat.repository.js';
import * as users from '../repositories/user.repository.js';
import { heartbeat } from '../services/presence.service.js';

/**
 * Messaging socket events (Technical Spec §9). Every payload is validated
 * against the shared zod schema before touching business logic, mirroring the
 * REST validation rule (Build Instructions §6).
 */

type AckCallback<T> = (result: T) => void;

/** Parses a payload; invalid input answers the ack (if any) and stops. */
function parse<TSchema extends ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  ack?: AckCallback<{ ok: false; code: string; message: string }>,
): z.infer<TSchema> | null {
  const result = schema.safeParse(payload);
  if (result.success) return result.data as z.infer<TSchema>;
  ack?.({ ok: false, code: 'VALIDATION_FAILED', message: 'Invalid payload' });
  return null;
}

function toAckError(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof AppError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: 'INTERNAL', message: 'Something went wrong' };
}

export function registerChatHandlers(socket: Socket): void {
  const userId = socket.data.userId as string;
  const deviceId = socket.data.deviceId as string;

  socket.on(CLIENT_EVENTS.MESSAGE_SEND, (payload: unknown, ack?: AckCallback<MessageSendAck>) => {
    void (async () => {
      const parsed = parse(messageSendSchema, payload, ack);
      if (!parsed) return;
      try {
        const message = await sendMessage(userId, parsed);
        ack?.({ ok: true, message });
      } catch (error) {
        logger.warn(
          { event: 'socket.message_send_failed', userId, err: error },
          'message send rejected',
        );
        ack?.(toAckError(error));
      }
    })();
  });

  socket.on(CLIENT_EVENTS.MESSAGE_ACK, (payload: unknown) => {
    void (async () => {
      const parsed = parse(messageAckSchema, payload);
      if (!parsed) return;
      try {
        await ackMessages(userId, parsed);
      } catch (error) {
        logger.warn({ event: 'socket.message_ack_failed', userId, err: error }, 'ack rejected');
      }
    })();
  });

  socket.on(CLIENT_EVENTS.MESSAGE_SYNC, (payload: unknown, ack?: AckCallback<MessageSyncAck>) => {
    void (async () => {
      const parsed = parse(messageSyncSchema, payload, ack);
      if (!parsed) return;
      try {
        const messages = await syncMessages(userId, parsed.conversations);
        ack?.({ ok: true, messages });
      } catch (error) {
        ack?.(toAckError(error));
      }
    })();
  });

  for (const [event, typing] of [
    [CLIENT_EVENTS.TYPING_START, true],
    [CLIENT_EVENTS.TYPING_STOP, false],
  ] as const) {
    socket.on(event, (payload: unknown) => {
      void (async () => {
        const parsed = parse(typingSchema, payload);
        if (!parsed) return;
        // Relay only within the conversation's membership (§21.1).
        const membership = await chat.getMembership(parsed.conversationId, userId);
        if (!membership) return;
        const user = await users.findById(userId);
        if (!user) return;
        const event: TypingEventPayload = {
          conversationId: parsed.conversationId,
          userId,
          displayName: user.displayName,
          typing,
        };
        const io = getIo();
        for (const memberId of await chat.memberIds(parsed.conversationId)) {
          if (memberId !== userId) {
            io?.to(`user:${memberId}`).emit(SERVER_EVENTS.TYPING_UPDATE, event);
          }
        }
      })();
    });
  }

  socket.on(CLIENT_EVENTS.PRESENCE_HEARTBEAT, () => {
    void heartbeat(deviceId);
  });
}
