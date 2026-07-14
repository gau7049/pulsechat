import type { NotificationDto } from '@pulsechat/shared';

/**
 * Shared between the bell dropdown and the full notification center page
 * (§24.5) — one copy line and one deep-link target per notification type.
 */

export function describeNotification(n: NotificationDto): string {
  const from = (n.payload.from as { displayName?: string } | undefined)?.displayName ?? 'Someone';
  switch (n.type) {
    case 'friend_request':
      return `${from} sent you a friend request`;
    case 'friend_accept':
      return `${from} accepted your friend request`;
    case 'post_like':
      return `${from} liked your post`;
    case 'post_comment':
      return `${from} commented on your post`;
    case 'comment_like':
      return `${from} liked your comment`;
    case 'tag':
      return `${from} tagged you in a post`;
    case 'new_user_suggestion':
      return `${from} just joined — you may know them`;
    case 'story_reaction':
      return `${from} reacted to your story`;
    case 'story_poll_response':
      return `${from} responded to your story`;
    case 'friendship_anniversary':
      return `You and ${from} became friends on this day`;
    case 'moderation_warning':
      return String(n.payload.reason ?? 'Your content was reviewed by moderation');
    default:
      return `${from} sent you a notification`;
  }
}

/** The liked/commented/tagged post's photo, when the notification carries one (§13/§24). */
export function thumbnailFor(n: NotificationDto): string | null {
  const url = n.payload.postMediaUrl;
  return typeof url === 'string' ? url : null;
}

/** Where tapping a notification should take you, when it has an obvious target. */
export function deepLinkFor(n: NotificationDto): string | null {
  const from = (n.payload.from as { username?: string } | undefined)?.username;
  switch (n.type) {
    case 'post_like':
    case 'post_comment':
    case 'comment_like':
    case 'tag': {
      const postId = n.payload.postId as string | undefined;
      return postId ? `/p/${postId}` : null;
    }
    case 'friend_request':
    case 'friend_accept':
    case 'new_user_suggestion':
    case 'story_reaction':
    case 'story_poll_response':
    case 'friendship_anniversary':
      return from ? `/u/${from}` : null;
    default:
      return null;
  }
}
