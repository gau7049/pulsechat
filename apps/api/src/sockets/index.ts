import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Attaches Socket.IO to the shared HTTP server (Technical Spec §2: one Node
 * process serves REST + sockets).
 *
 * M0 stub: the handshake requires an auth token but only checks presence.
 * M1 replaces the placeholder with real JWT verification and maps each socket
 * to its authenticated user; M3 adds the event handlers and resync-on-connect.
 */
export function attachSockets(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.APP_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    // TODO(M1): verify JWT, attach socket.data.userId, join user room.
    next();
  });

  io.on('connection', (socket: Socket) => {
    logger.info({ event: 'socket.connected', socketId: socket.id }, 'socket connected');
    socket.on('disconnect', (reason) => {
      logger.info(
        { event: 'socket.disconnected', socketId: socket.id, reason },
        'socket disconnected',
      );
    });
  });

  return io;
}
