import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { env } from '../config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestContext } from './middleware/request-context.js';
import { accountRouter } from './routes/account.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { chatRouter } from './routes/chat.routes.js';
import { feedRouter } from './routes/feed.routes.js';
import { hashtagsRouter } from './routes/hashtags.routes.js';
import { healthzRouter } from './routes/healthz.js';
import { invitesRouter } from './routes/invites.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { postsRouter } from './routes/posts.routes.js';
import { presenceRouter } from './routes/presence.routes.js';
import { reportsRouter } from './routes/reports.routes.js';
import { rtcRouter } from './routes/rtc.routes.js';
import { socialRouter } from './routes/social.routes.js';
import { statusRouter } from './routes/status.routes.js';
import { usersRouter } from './routes/users.routes.js';

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
  app.use(cookieParser());

  app.use(healthzRouter);
  app.use(authRouter);
  app.use(accountRouter);
  app.use(usersRouter);
  app.use(socialRouter);
  app.use(invitesRouter);
  app.use(notificationsRouter);
  app.use(chatRouter);
  app.use(statusRouter);
  app.use(presenceRouter);
  app.use(rtcRouter);
  app.use(postsRouter);
  app.use(hashtagsRouter);
  app.use(feedRouter);
  app.use(reportsRouter);
  app.use(adminRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
