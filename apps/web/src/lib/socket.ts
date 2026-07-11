import { io, type Socket } from 'socket.io-client';

/**
 * Socket.IO client singleton (Requirement Scope §21.1): connects on login,
 * closes on logout, reconnects with backoff, and re-reads the (possibly
 * refreshed) access token on every handshake attempt.
 */

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

let socket: Socket | null = null;
let tokenProvider: (() => string | null) | null = null;
let refreshSession: (() => Promise<unknown>) | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(
  getToken: () => string | null,
  onAuthFailure: () => Promise<unknown>,
): Socket {
  tokenProvider = getToken;
  refreshSession = onAuthFailure;
  if (socket) return socket;

  socket = io(BASE_URL, {
    // Function form: evaluated on every (re)connection attempt, so a token
    // refreshed since the last attempt is picked up automatically.
    auth: (cb) => cb({ token: tokenProvider?.() ?? '' }),
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
  });

  socket.on('connect_error', (error) => {
    if (error.message === 'UNAUTHORIZED') {
      // Likely an expired access token: any authenticated REST call runs the
      // single-flight refresh; the next retry then carries a fresh token.
      void refreshSession?.();
    }
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  tokenProvider = null;
  refreshSession = null;
}
