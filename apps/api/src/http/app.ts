import cors from 'cors';
import express, { type Express } from 'express';
import { env } from '../config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestContext } from './middleware/request-context.js';
import { healthzRouter } from './routes/healthz.js';

/**
 * Builds the Express app without binding a port, so tests can exercise it via
 * supertest and the entrypoint can share it with Socket.IO on one server.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use(healthzRouter);
  // Feature routers mount here milestone by milestone (auth, users, …).

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
