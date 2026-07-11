import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../services/token.service.js';

/**
 * Attaches Socket.IO to the shared HTTP server (Technical Spec §2: one Node
 * process serves REST + sockets). The handshake verifies the JWT and maps the
 * socket to its user (§21.1); each socket joins a per-user room so later
 * milestones can target `user:{id}` for fan-out. Event handlers arrive in M3.
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
    logger.info(
      { event: 'socket.connected', socketId: socket.id, userId: socket.data.userId },
      'socket connected',
    );
    socket.on('disconnect', (reason) => {
      logger.info(
        { event: 'socket.disconnected', socketId: socket.id, userId: socket.data.userId, reason },
        'socket disconnected',
      );
    });
  });

  return io;
}
