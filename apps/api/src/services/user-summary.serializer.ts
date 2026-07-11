import type { User } from '@prisma/client';
import type { UserSummaryDto } from '@pulsechat/shared';

/** The minimal public card — the only user shape M2 endpoints expose. */
export function toUserSummaryDto(
  user: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>,
): UserSummaryDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}
