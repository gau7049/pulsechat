import type { ConversationDto, ConversationMemberDto } from '@pulsechat/shared';

/** Display helpers shared by the conversation list and the chat window. */

export function otherMember(
  conversation: ConversationDto,
  myId: string,
): ConversationMemberDto | undefined {
  return conversation.members.find((m) => m.user.id !== myId);
}

export function conversationTitle(conversation: ConversationDto, myId: string): string {
  if (conversation.type === 'group') return conversation.name ?? 'Group';
  return otherMember(conversation, myId)?.user.displayName ?? 'Conversation';
}

export function lastSeenLabel(member: ConversationMemberDto | undefined): string {
  if (!member) return '';
  if (member.online) return 'Online';
  if (!member.lastSeenAt) return '';
  const date = new Date(member.lastSeenAt);
  const sameDay = date.toDateString() === new Date().toDateString();
  return `Last seen ${sameDay ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString()}`;
}
