import { z } from 'zod';
import { displayNameSchema } from './auth.js';
import { birthDateSchema } from './auth-requests.js';

export const visibilityEnum = z.enum(['public', 'friends', 'private']);
export type Visibility = z.infer<typeof visibilityEnum>;

export const lastSeenVisibilityEnum = z.enum(['everyone', 'friends', 'no_one']);
export const statusVisibilityEnum = z.enum(['everyone', 'friends']);
export type StatusVisibility = z.infer<typeof statusVisibilityEnum>;

/** PATCH /users/me (Requirement Scope §7 optional fields). */
export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema,
    bio: z.string().trim().max(300).nullable(),
    country: z.string().trim().max(60).nullable(),
    state: z.string().trim().max(60).nullable(),
    birthDate: birthDateSchema.nullable(),
    visibility: visibilityEnum,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;

/** PATCH /users/me/privacy (Requirement Scope §8). */
export const updatePrivacySchema = z
  .object({
    whoCanSendRequests: visibilityEnum,
    emailVisible: z.boolean(),
    birthdateVisible: z.boolean(),
    lastSeenVisibility: lastSeenVisibilityEnum,
    statusVisibility: statusVisibilityEnum,
    readReceipts: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdatePrivacyBody = z.infer<typeof updatePrivacySchema>;

/** The signed-in user's own record (never exposes passwordHash). */
export interface MeDto {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  birthDate: string | null;
  country: string | null;
  state: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** Own X25519 public key — wraps conversation keys for self (Tech Spec §6). */
  publicKey: string | null;
  visibility: Visibility;
  role: 'user' | 'admin';
  otpEnabled: boolean;
  onboardedAt: string | null;
  createdAt: string;
  privacy: {
    whoCanSendRequests: Visibility;
    emailVisible: boolean;
    birthdateVisible: boolean;
    lastSeenVisibility: z.infer<typeof lastSeenVisibilityEnum>;
    statusVisibility: z.infer<typeof statusVisibilityEnum>;
    readReceipts: boolean;
  };
}

export interface DeviceDto {
  id: string;
  userAgent: string;
  recognized: boolean;
  lastSeenAt: string;
  createdAt: string;
  /** True for the device making the request. */
  current: boolean;
}

export interface AuditLogEntryDto {
  id: string;
  eventType: string;
  ip: string | null;
  device: string | null;
  createdAt: string;
}

/** Successful auth responses: access token in body, refresh token in cookie. */
export interface AuthResultDto {
  user: MeDto;
  accessToken: string;
}

/** Password/magic-link step succeeded but 2FA is required to finish. */
export interface OtpChallengeDto {
  otpRequired: true;
  pendingToken: string;
}
