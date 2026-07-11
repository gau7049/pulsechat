import { describe, expect, it } from 'vitest';
import {
  displayNameSchema,
  passwordSchema,
  passwordStrength,
  recoveryEmailSchema,
  usernameSchema,
} from './auth.js';

describe('usernameSchema', () => {
  it('accepts valid usernames', () => {
    for (const name of ['gautam', 'user_01', 'a.b.c', 'ABC123']) {
      expect(usernameSchema.safeParse(name).success).toBe(true);
    }
  });

  it('rejects usernames outside the length bounds', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('a'.repeat(21)).success).toBe(false);
  });

  it('rejects disallowed characters', () => {
    for (const name of ['has space', 'emoji😀', 'dash-ed', 'at@sign']) {
      expect(usernameSchema.safeParse(name).success).toBe(false);
    }
  });

  it('rejects reserved words case-insensitively', () => {
    expect(usernameSchema.safeParse('admin').success).toBe(false);
    expect(usernameSchema.safeParse('Admin').success).toBe(false);
    expect(usernameSchema.safeParse('SUPPORT').success).toBe(false);
  });
});

describe('displayNameSchema', () => {
  it('trims and requires non-empty', () => {
    expect(displayNameSchema.safeParse('   ').success).toBe(false);
    expect(displayNameSchema.parse('  Gautam ')).toBe('Gautam');
  });
});

describe('passwordSchema', () => {
  it('requires minimum length and letter+number mix', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('lettersonly').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('letters123').success).toBe(true);
  });
});

describe('recoveryEmailSchema', () => {
  it('accepts only gmail.com addresses', () => {
    expect(recoveryEmailSchema.safeParse('me@gmail.com').success).toBe(true);
    expect(recoveryEmailSchema.safeParse('ME@GMAIL.COM').success).toBe(true);
    expect(recoveryEmailSchema.safeParse('me@outlook.com').success).toBe(false);
    expect(recoveryEmailSchema.safeParse('me@tempmail.io').success).toBe(false);
    expect(recoveryEmailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('passwordStrength', () => {
  it('grades from weak to strong', () => {
    expect(passwordStrength('abc')).toBe('weak');
    expect(passwordStrength('abcdefg1')).toBe('fair');
    expect(passwordStrength('Abcdefg1')).toBe('good');
    expect(passwordStrength('Abcdefg1!longer')).toBe('strong');
  });
});
