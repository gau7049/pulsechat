import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('applies development defaults', () => {
    const env = parseEnv({} as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.APP_ORIGIN).toBe('http://localhost:8000');
  });

  it('coerces PORT from a string', () => {
    expect(parseEnv({ PORT: '8080' } as NodeJS.ProcessEnv).PORT).toBe(8080);
  });

  it('rejects a malformed APP_ORIGIN', () => {
    expect(() => parseEnv({ APP_ORIGIN: 'not a url' } as NodeJS.ProcessEnv)).toThrow(/APP_ORIGIN/);
  });

  it('allows DATABASE_URL to be absent outside production', () => {
    expect(parseEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).DATABASE_URL).toBeUndefined();
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL is required in production/,
    );
  });

  it('rejects short JWT secrets', () => {
    expect(() => parseEnv({ JWT_ACCESS_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
});
