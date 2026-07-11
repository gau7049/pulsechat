import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { displayNameSchema, passwordSchema, recoveryEmailSchema, usernameSchema } from './auth.js';

/** ISO yyyy-mm-dd birth date, enforcing the §6.1 minimum-age requirement. */
export const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the yyyy-mm-dd format')
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid date' })
  .refine(
    (value) => {
      const birth = new Date(value);
      const now = new Date();
      const age =
        now.getFullYear() -
        birth.getFullYear() -
        (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
      return age >= LIMITS.MIN_AGE_YEARS && age < 130;
    },
    { message: `You must be at least ${LIMITS.MIN_AGE_YEARS} years old` },
  );

/**
 * Registration (Requirement Scope §6.1). The client generates an X25519
 * keypair at signup and sends only the public key (Technical Spec §6).
 */
export const registerBodySchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  email: recoveryEmailSchema.optional(),
  birthDate: birthDateSchema.optional(),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to the Terms of Service and Privacy Policy' }),
  }),
  publicKey: z.string().min(32).max(128),
  turnstileToken: z.string().min(1).optional(),
  inviteCode: z.string().min(1).max(64).optional(),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, 'Password is required'),
  turnstileToken: z.string().min(1).optional(),
  /** Stable per-browser identifier for the §6.6 new-device check. */
  deviceFingerprint: z.string().min(8).max(128),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const magicLinkRequestSchema = z.object({
  email: recoveryEmailSchema,
  turnstileToken: z.string().min(1).optional(),
});
export type MagicLinkRequestBody = z.infer<typeof magicLinkRequestSchema>;

/** Single-use tokens arriving from emailed links (magic link, verify, device). */
export const emailTokenSchema = z.object({
  token: z.string().min(16).max(512),
  deviceFingerprint: z.string().min(8).max(128).optional(),
});
export type EmailTokenBody = z.infer<typeof emailTokenSchema>;

export const otpVerifySchema = z.object({
  /** Short-lived pending-login token issued by the password step. */
  pendingToken: z.string().min(16).max(512),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type OtpVerifyBody = z.infer<typeof otpVerifySchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: recoveryEmailSchema,
  turnstileToken: z.string().min(1).optional(),
});
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(512),
  newPassword: passwordSchema,
});
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
