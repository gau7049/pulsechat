import { Router } from 'express';

/**
 * Liveness endpoint polled by UptimeRobot every 5 minutes (Technical Spec
 * §16). Deliberately DB-free: it answers "is the process up", and on Render's
 * free tier it doubles as the wake-up ping for a slept instance.
 */
export const healthzRouter: Router = Router();

healthzRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
