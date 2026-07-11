import { createServer } from 'node:http';
import { env } from './config/env.js';
import { createApp } from './http/app.js';
import { setIo } from './lib/io.js';
import { logger } from './lib/logger.js';
import { attachSockets } from './sockets/index.js';

const httpServer = createServer(createApp());
setIo(attachSockets(httpServer));

httpServer.listen(env.PORT, () => {
  logger.info(
    { event: 'server.started', port: env.PORT, nodeEnv: env.NODE_ENV },
    `API + sockets listening on :${env.PORT}`,
  );
  if (!env.DATABASE_URL) {
    logger.warn(
      { event: 'config.missing', variable: 'DATABASE_URL' },
      'DATABASE_URL is not set — create the free Supabase project and fill .env (see .env.example)',
    );
  }
});
