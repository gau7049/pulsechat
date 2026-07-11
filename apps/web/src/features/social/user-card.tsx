import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { UserSummaryDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';

/** One person in any list — links to their profile, with an action slot. */
export function UserCard({
  user,
  subtitle,
  action,
}: {
  user: UserSummaryDto;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-sunken">
      <Link
        to={`/u/${user.username}`}
        className="flex min-w-0 flex-1 items-center gap-3"
        aria-label={`View ${user.displayName}'s profile`}
      >
        <Avatar name={user.displayName} src={user.avatarUrl} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{user.displayName}</span>
          <span className="block truncate text-xs text-fg-muted">
            @{user.username}
            {subtitle ? ` · ${subtitle}` : ''}
          </span>
        </span>
      </Link>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
