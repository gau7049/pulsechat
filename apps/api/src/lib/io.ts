import type { Server as SocketIOServer } from 'socket.io';

/**
 * Shared handle on the Socket.IO server so HTTP-layer services can fan events
 * out to `user:{id}` rooms. Set once at boot; stays null under supertest,
 * where emits become no-ops.
 */
let io: SocketIOServer | null = null;

export function setIo(server: SocketIOServer): void {
  io = server;
}

export function getIo(): SocketIOServer | null {
  return io;
}
