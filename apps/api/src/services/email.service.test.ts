import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * M12: the console-fallback path (no BREVO_API_KEY) is dev-only convenience —
 * it must never leak an actual action link/OTP code into production logs.
 */
describe('email.service sendEmail console fallback', () => {
  afterEach(() => {
    vi.doUnmock('../config/env.js');
    vi.doUnmock('../lib/logger.js');
    vi.resetModules();
  });

  function mockLogger() {
    const warn = vi.fn();
    vi.doMock('../lib/logger.js', () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }));
    return warn;
  }

  it('logs the action link/code in development', async () => {
    vi.doMock('../config/env.js', () => ({ env: { NODE_ENV: 'development' } }));
    const warn = mockLogger();
    const { sendEmail } = await import('./email.service.js');

    await sendEmail({
      to: 'user@example.com',
      subject: 'test',
      heading: 'test',
      bodyLines: ['contains OTP 123456'],
      actionUrl: 'https://example.com/magic-link?token=super-secret',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const [payload] = warn.mock.calls[0]!;
    expect(payload.actionUrl).toBe('https://example.com/magic-link?token=super-secret');
    expect(payload.bodyLines).toEqual(['contains OTP 123456']);
  });

  it('redacts the action link/code in production', async () => {
    vi.doMock('../config/env.js', () => ({ env: { NODE_ENV: 'production' } }));
    const warn = mockLogger();
    const { sendEmail } = await import('./email.service.js');

    await sendEmail({
      to: 'user@example.com',
      subject: 'test',
      heading: 'test',
      bodyLines: ['contains OTP 123456'],
      actionUrl: 'https://example.com/magic-link?token=super-secret',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const [payload, message] = warn.mock.calls[0]!;
    expect(payload.actionUrl).toBeUndefined();
    expect(payload.bodyLines).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('super-secret');
    expect(String(message)).toMatch(/redacted/i);
  });
});
