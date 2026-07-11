import type { MeDto } from '@pulsechat/shared';
import type { UserWithPrivacy } from '../repositories/user.repository.js';

/** Maps a User row to the owner-facing DTO — the only place this shape is built. */
export function toMeDto(user: UserWithPrivacy): MeDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    emailVerified: user.emailVerified,
    birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
    country: user.country,
    state: user.state,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    visibility: user.visibility,
    role: user.role,
    otpEnabled: user.otpEnabled,
    onboardedAt: user.onboardedAt ? user.onboardedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    privacy: {
      whoCanSendRequests: user.privacy?.whoCanSendRequests ?? 'public',
      emailVisible: user.privacy?.emailVisible ?? false,
      birthdateVisible: user.privacy?.birthdateVisible ?? false,
      lastSeenVisibility: user.privacy?.lastSeenVisibility ?? 'everyone',
      statusVisibility: user.privacy?.statusVisibility ?? 'everyone',
      readReceipts: user.privacy?.readReceipts ?? true,
    },
  };
}
