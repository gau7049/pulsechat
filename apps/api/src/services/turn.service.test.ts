import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('turn.service getIceServers', () => {
  afterEach(() => {
    vi.doUnmock('../config/env.js');
    vi.resetModules();
  });

  it('returns STUN only when TURN is not configured', async () => {
    vi.doMock('../config/env.js', () => ({ env: {} }));
    const { getIceServers } = await import('./turn.service.js');
    const result = getIceServers('user-1');
    expect(result.iceServers).toHaveLength(1);
    expect(result.iceServers[0]!.urls).toEqual(['stun:stun.l.google.com:19302']);
    expect(result.iceServers[0]!.username).toBeUndefined();
  });

  it('adds a short-lived, deterministic coturn credential when TURN is configured', async () => {
    vi.doMock('../config/env.js', () => ({
      env: { TURN_HOST: 'turn.example.com', TURN_SHARED_SECRET: 'test-secret' },
    }));
    const { getIceServers } = await import('./turn.service.js');
    const before = Math.floor(Date.now() / 1000);
    const result = getIceServers('user-1');

    expect(result.iceServers).toHaveLength(2);
    const turnEntry = result.iceServers[1]!;
    expect(turnEntry.urls).toEqual([
      'turn:turn.example.com:3478',
      'turn:turn.example.com:3478?transport=tcp',
    ]);

    const [expiresAtStr, userId] = turnEntry.username!.split(':');
    expect(userId).toBe('user-1');
    expect(Number(expiresAtStr)).toBeGreaterThanOrEqual(before);

    const expectedCredential = createHmac('sha1', 'test-secret')
      .update(turnEntry.username!)
      .digest('base64');
    expect(turnEntry.credential).toBe(expectedCredential);
  });
});
