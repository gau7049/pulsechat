import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { byUserOrIp } from './rate-limit.js';

/**
 * M12: `apiLimiter` keys by user, not IP, wherever `req.auth` exists (every
 * mount point except the one public invite-code lookup) — otherwise a
 * distributed attacker on one compromised account dodges the limit by
 * spreading requests across IPs.
 */
describe('byUserOrIp', () => {
  it('keys by the authenticated user id when present', () => {
    const req = { auth: { sub: 'user-123' }, ip: '203.0.113.5' } as unknown as Request;
    expect(byUserOrIp(req)).toBe('user-123');
  });

  it('falls back to the IP for unauthenticated requests', () => {
    const req = { auth: undefined, ip: '203.0.113.5' } as unknown as Request;
    expect(byUserOrIp(req)).toBe('203.0.113.5');
  });
});
