import { z } from 'zod';

/**
 * Account lifecycle: deactivate/delete/restore/export (Requirement Scope §16).
 */

/** POST /account/deactivate, POST /account/delete — re-confirm the password
 * before an irreversible-ish action, matching the change-password flow. */
export const accountActionSchema = z.object({
  currentPassword: z.string().min(1),
});
export type AccountActionBody = z.infer<typeof accountActionSchema>;

/** POST /account/restore/request */
export const restoreRequestSchema = z.object({
  username: z.string().trim().min(1),
});
export type RestoreRequestBody = z.infer<typeof restoreRequestSchema>;

/** POST /account/restore/confirm */
export const restoreConfirmSchema = z.object({
  token: z.string().min(1),
});
export type RestoreConfirmBody = z.infer<typeof restoreConfirmSchema>;
