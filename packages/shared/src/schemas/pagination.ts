import { z } from 'zod';
import { LIMITS } from '../constants.js';

/**
 * Every list endpoint is cursor-paginated (Technical Spec §8/§14): requests
 * carry an opaque cursor + limit, responses return `{ items, nextCursor }`.
 */
export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(LIMITS.PAGE_SIZE_DEFAULT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  /** Absent when there are no further pages. */
  nextCursor?: string;
}
