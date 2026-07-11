import { describe, expect, it } from 'vitest';
import { LIMITS } from '../constants.js';
import { paginationQuerySchema } from './pagination.js';

describe('paginationQuerySchema', () => {
  it('applies the default limit when absent', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: LIMITS.PAGE_SIZE_DEFAULT });
  });

  it('coerces string limits from query strings', () => {
    expect(paginationQuerySchema.parse({ limit: '5' }).limit).toBe(5);
  });

  it('rejects limits above the cap and non-positive limits', () => {
    expect(paginationQuerySchema.safeParse({ limit: LIMITS.PAGE_SIZE_MAX + 1 }).success).toBe(
      false,
    );
    expect(paginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('passes cursors through opaquely', () => {
    expect(paginationQuerySchema.parse({ cursor: 'abc' }).cursor).toBe('abc');
    expect(paginationQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
  });
});
