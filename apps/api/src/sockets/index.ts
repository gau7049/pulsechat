import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import {
  broadcastPresence,
  heartbeat,
  socketConnected,
  socketDisconnected,
} from '../services/presence.service.js';
import { verifyAccessToken } from '../services/token.service.js';
import { registerChatHandlers } from './chat.handlers.js';

/**
 * Attaches Socket.IO to the shared HTTP server (Technical Spec §2: one Node
 * process serves REST + sockets). The handshake verifies the JWT and maps the
 * socket to its user (§21.1); each socket joins a per-user room so fan-out can
 * target `user:{id}`. Multiple sockets per user = multiple device sessions.
 */
export function attachSockets(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.APP_ORIGIN, credentials: true },
  });

  io.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    try {
      const claims = await verifyAccessToken(token);
      socket.data.userId = claims.sub;
      socket.data.deviceId = claims.deviceId;
      await socket.join(`user:${claims.sub}`);
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    logger.info({ event: 'socket.connected', socketId: socket.id, userId }, 'socket connected');

    if (socketConnected(userId, socket.id)) {
      void broadcastPresence(userId, true);
    }
    void heartbeat(socket.data.deviceId as string);
    registerChatHandlers(socket);

    socket.on('disconnect', (reason) => {
      logger.info(
        { event: 'socket.disconnected', socketId: socket.id, userId, reason },
        'socket disconnected',
      );
      if (socketDisconnected(userId, socket.id)) {
        void heartbeat(socket.data.deviceId as string);
        void broadcastPresence(userId, false);
      }
    });
  });

  return io;
}
