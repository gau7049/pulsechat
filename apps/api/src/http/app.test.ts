import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

describe('GET /healthz', () => {
  it('responds ok with uptime', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('echoes a request id header', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('honors an incoming X-Request-Id for traceability', async () => {
    const res = await request(app).get('/healthz').set('X-Request-Id', 'trace-me-123');
    expect(res.headers['x-request-id']).toBe('trace-me-123');
  });
});

describe('error shape', () => {
  it('returns the shared JSON error body for unknown routes', async () => {
    const res = await request(app).get('/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects malformed JSON bodies with the shared shape, not a stack trace', async () => {
    const res = await request(app)
      .post('/healthz')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.code).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('SyntaxError');
  });
});
