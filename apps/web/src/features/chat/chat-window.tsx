import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CLIENT_EVENTS, type ConversationDto, type MessageDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { ApiError } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../auth/auth-context';
import { useStartCall } from '../calls/use-calls';
import { ImageAnnotator } from '../annotate/image-annotator';
import { uploadAttachment, type AttachmentKind } from './attachments';
import { getTypingSnapshot, setActiveConversation, typingEmitter } from './chat-live-store';
import { conversationTitle, lastSeenLabel, otherMember } from './conversation-utils';
import { groupByDay } from './date-utils';
import { GroupInfoModal } from './group-info-modal';
import { MediaGalleryModal } from './media-gallery-modal';
import { MessageBubble, type BubbleActions } from './message-bubble';
import { parseEnvelope, serializeEnvelope, type MessageEnvelope } from './message-envelope';
import { STICKERS } from './stickers';
import {
  sendAck,
  useConversationSettings,
  useEditMessage,
  useLeaveConversation,
  useMessages,
  useOutboxFor,
  useRetryMessage,
  useSendMessage,
  useSendToConversation,
  useConversations,
} from './use-chat';
import { getCachedPlaintext } from './use-decrypted-message';
import { getWallpaper, setWallpaper, WALLPAPERS } from './wallpaper';

/**
 * The conversation view (§14): history, live bubbles, typed composer with
 * attachments/stickers/replies/edits/drafts, in-chat search, wallpaper, and
 * the conversation menu (pin/mute/archive, leave).
 */

type ComposerMode =
  | { kind: 'normal' }
  | { kind: 'reply'; target: MessageDto }
  | { kind: 'edit'; target: MessageDto; originalText: string };

/** A history message or an in-flight outbox entry, ready for day-grouping. */
interface TimelineEntry {
  key: string;
  createdAt: string;
  message: MessageDto;
  localState?: 'pending' | 'failed';
  onRetry?: () => void;
}

export function ChatWindow({ conversation }: { conversation: ConversationDto }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const messagesQuery = useMessages(conversation.id);
  const outboxEntries = useOutboxFor(conversation.id);
  const retry = useRetryMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ComposerMode>({ kind: 'normal' });
  const [forwarding, setForwarding] = useState<MessageDto | null>(null);
  const [searching, setSearching] = useState(false);
  const [wallpaperVersion, setWallpaperVersion] = useState(0);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [mediaGalleryOpen, setMediaGalleryOpen] = useState(false);

  const messages = useMemo(() => {
    const items = messagesQuery.data?.pages.flatMap((page) => page.items) ?? [];
    return [...items].sort((a, b) => a.sequence - b.sequence);
  }, [messagesQuery.data]);

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const topSequence = messages.at(-1)?.sequence ?? 0;

  // Merge history + in-flight outbox entries into one chronological timeline,
  // then bucket by calendar day for the sticky date separators.
  const timeline = useMemo(() => {
    const fromMessages: TimelineEntry[] = messages.map((message) => ({
      key: message.id,
      createdAt: message.createdAt,
      message,
    }));
    const fromOutbox: TimelineEntry[] = outboxEntries.map((entry) => ({
      key: entry.clientUuid,
      createdAt: entry.createdAt,
      message: outboxEntryAsMessage(entry, user?.id ?? ''),
      localState: entry.status,
      onRetry: entry.status === 'failed' ? () => retry(entry.clientUuid) : undefined,
    }));
    return [...fromMessages, ...fromOutbox].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [messages, outboxEntries, retry, user?.id]);

  const dayGroups = useMemo(() => groupByDay(timeline), [timeline]);

  useEffect(() => {
    setActiveConversation(conversation.id);
    return () => setActiveConversation(null);
  }, [conversation.id]);

  useEffect(() => {
    if (topSequence > 0 && document.visibilityState === 'visible') {
      sendAck(queryClient, conversation.id, topSequence, 'read');
    }
  }, [queryClient, conversation.id, topSequence]);

  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, outboxEntries.length]);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (
          observed[0]?.isIntersecting &&
          messagesQuery.hasNextPage &&
          !messagesQuery.isFetchingNextPage
        ) {
          const before = root.scrollHeight;
          void messagesQuery.fetchNextPage().then(() => {
            requestAnimationFrame(() => {
              root.scrollTop += root.scrollHeight - before;
            });
          });
        }
      },
      { root, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [messagesQuery]);

  /** §14.5: jump to (and briefly highlight) a referenced message. */
  async function scrollToMessage(messageId: string): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const el = scrollRef.current?.querySelector(`[data-message-id="${messageId}"]`);
      if (el) {
        stickToBottom.current = false;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('bg-accent-soft', 'rounded-xl', 'transition-colors');
        setTimeout(() => el.classList.remove('bg-accent-soft'), 1600);
        return;
      }
      if (!messagesQuery.hasNextPage) break;
      await messagesQuery.fetchNextPage();
    }
  }

  if (!user) return null;

  const bubbleActions: BubbleActions = {
    onReply: (message) => setMode({ kind: 'reply', target: message }),
    onEdit: (message, originalText) => setMode({ kind: 'edit', target: message, originalText }),
    onForward: (message) => setForwarding(message),
    onQuoteClick: (messageId) => void scrollToMessage(messageId),
  };
  const wallpaper = getWallpaper(conversation.id);

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={conversationTitle(conversation, user.id)}
    >
      <ChatHeader
        conversation={conversation}
        myId={user.id}
        onToggleSearch={() => setSearching((s) => !s)}
        onWallpaperChanged={() => setWallpaperVersion((v) => v + 1)}
        onOpenGroupInfo={() => setGroupInfoOpen(true)}
        onOpenMedia={() => setMediaGalleryOpen(true)}
      />

      {searching && (
        <SearchPanel
          messages={messages}
          conversation={conversation}
          myId={user.id}
          onJump={(id) => void scrollToMessage(id)}
          onClose={() => setSearching(false)}
        />
      )}

      <div
        ref={scrollRef}
        data-wallpaper-version={wallpaperVersion}
        style={{ background: wallpaper.css }}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
      >
        <div ref={topSentinelRef} />
        {messagesQuery.isLoading && (
          <div aria-hidden>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}
        {messagesQuery.isError && (
          <EmptyState
            icon="⚠️"
            title="Could not load messages"
            action={
              <Button variant="secondary" onClick={() => void messagesQuery.refetch()}>
                Retry
              </Button>
            }
          />
        )}
        {messagesQuery.isFetchingNextPage && <SkeletonRow />}
        {!messagesQuery.isLoading && messages.length === 0 && outboxEntries.length === 0 && (
          <EmptyState
            icon="💬"
            title="Say hello"
            description="Messages are end-to-end protected — the server only ever sees ciphertext."
          />
        )}
        {dayGroups.map((group) => (
          <div key={group.label}>
            <div className="sticky top-0 z-10 flex justify-center py-1.5">
              <span className="rounded-full bg-surface-raised/90 px-3 py-1 text-[11px] font-semibold text-fg-muted shadow-sm backdrop-blur">
                {group.label}
              </span>
            </div>
            <div className="space-y-2">
              {group.items.map((item) => (
                <MessageBubble
                  key={item.key}
                  userId={user.id}
                  conversation={conversation}
                  message={item.message}
                  repliedMessage={
                    item.message.replyToId ? messagesById.get(item.message.replyToId) : undefined
                  }
                  localState={item.localState}
                  onRetry={item.onRetry}
                  actions={bubbleActions}
                />
              ))}
            </div>
          </div>
        ))}
        <TypingLine conversationId={conversation.id} />
      </div>

      <Composer
        conversation={conversation}
        userId={user.id}
        mode={mode}
        setMode={setMode}
        messagesById={messagesById}
      />

      {forwarding && (
        <ForwardModal
          userId={user.id}
          source={forwarding}
          sourceConversation={conversation}
          onClose={() => setForwarding(null)}
        />
      )}

      {groupInfoOpen && conversation.type === 'group' && (
        <GroupInfoModal
          conversation={conversation}
          myId={user.id}
          onClose={() => setGroupInfoOpen(false)}
        />
      )}

      {mediaGalleryOpen && (
        <MediaGalleryModal
          conversation={conversation}
          userId={user.id}
          onJump={(id) => void scrollToMessage(id)}
          onClose={() => setMediaGalleryOpen(false)}
        />
      )}
    </section>
  );
}

function outboxEntryAsMessage(
  entry: {
    clientUuid: string;
    conversationId: string;
    ciphertext: string;
    nonce: string;
    createdAt: string;
    replyToId?: string;
    forwardedFromId?: string;
  },
  userId: string,
): MessageDto {
  return {
    id: entry.clientUuid,
    conversationId: entry.conversationId,
    senderId: userId,
    ciphertext: entry.ciphertext,
    nonce: entry.nonce,
    sequence: Number.MAX_SAFE_INTEGER,
    clientUuid: entry.clientUuid,
    replyToId: entry.replyToId ?? null,
    forwardedFromId: entry.forwardedFromId ?? null,
    editedAt: null,
    deletedForEveryoneAt: null,
    deletedByAdmin: false,
    createdAt: entry.createdAt,
    reactions: [],
    starred: false,
  };
}

// ── Header + conversation menu (§14.11) ──────────────────────────────────────

function ChatHeader({
  conversation,
  myId,
  onToggleSearch,
  onWallpaperChanged,
  onOpenGroupInfo,
  onOpenMedia,
}: {
  conversation: ConversationDto;
  myId: string;
  onToggleSearch: () => void;
  onWallpaperChanged: () => void;
  onOpenGroupInfo: () => void;
  onOpenMedia: () => void;
}) {
  const other = otherMember(conversation, myId);
  const subtitle =
    conversation.type === 'group' ? `${conversation.members.length} members` : lastSeenLabel(other);
  const startCall = useStartCall();
  const { toast } = useToast();

  const handleStartCall = (kind: 'audio' | 'video') => {
    if (!other) return;
    toast('Calls work best on similar networks — connecting…', { kind: 'info' });
    void startCall(other.user, kind);
  };

  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
      <Link
        to="/chats"
        className="text-fg-muted hover:text-fg md:hidden"
        aria-label="Back to chats"
      >
        ←
      </Link>
      {conversation.type === 'direct' && other ? (
        <Link to={`/u/${other.user.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar
            name={other.user.displayName}
            src={other.user.avatarUrl}
            size="sm"
            online={other.online}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fg">
              {other.user.displayName}
            </span>
            {subtitle && <span className="block text-xs text-fg-muted">{subtitle}</span>}
          </span>
        </Link>
      ) : (
        <button
          type="button"
          onClick={onOpenGroupInfo}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Avatar name={conversation.name ?? 'Group'} src={conversation.photoUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fg">
              {conversation.name}
            </span>
            <span className="block truncate text-xs text-fg-muted">{subtitle}</span>
          </span>
        </button>
      )}

      {conversation.type === 'direct' && other && (
        <>
          <button
            type="button"
            aria-label="Start a voice call"
            title="Voice call"
            onClick={() => handleStartCall('audio')}
            className="rounded-lg px-2 py-1 text-fg-muted hover:bg-surface-sunken hover:text-fg"
          >
            📞
          </button>
          <button
            type="button"
            aria-label="Start a video call"
            title="Video call"
            onClick={() => handleStartCall('video')}
            className="rounded-lg px-2 py-1 text-fg-muted hover:bg-surface-sunken hover:text-fg"
          >
            🎥
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Search in conversation"
        title="Search in conversation"
        onClick={onToggleSearch}
        className="rounded-lg px-2 py-1 text-fg-muted hover:bg-surface-sunken hover:text-fg"
      >
        🔍
      </button>
      <ConversationMenu
        conversation={conversation}
        myId={myId}
        onWallpaperChanged={onWallpaperChanged}
        onOpenGroupInfo={onOpenGroupInfo}
        onOpenMedia={onOpenMedia}
      />
    </header>
  );
}

function ConversationMenu({
  conversation,
  myId,
  onWallpaperChanged,
  onOpenGroupInfo,
  onOpenMedia,
}: {
  conversation: ConversationDto;
  myId: string;
  onWallpaperChanged: () => void;
  onOpenGroupInfo: () => void;
  onOpenMedia: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pickingWallpaper, setPickingWallpaper] = useState(false);
  const settings = useConversationSettings(conversation.id);
  const leave = useLeaveConversation();

  function toggleSetting(key: 'pinned' | 'muted' | 'archived') {
    settings.mutate(
      { [key]: !conversation[key] },
      { onError: () => toast('Could not save that setting', { kind: 'error' }) },
    );
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Conversation options"
        title="Conversation options"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-lg px-2 py-1 text-fg-muted hover:bg-surface-sunken hover:text-fg"
      >
        ⋮
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute top-full right-0 z-40 mt-1 w-48 rounded-xl border border-border bg-surface-raised p-1 shadow-lg"
          >
            <HeaderMenuItem
              label={conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
              onClick={() => toggleSetting('pinned')}
            />
            <HeaderMenuItem
              label={conversation.muted ? 'Unmute notifications' : 'Mute notifications'}
              onClick={() => toggleSetting('muted')}
            />
            <HeaderMenuItem
              label={conversation.archived ? 'Unarchive' : 'Archive'}
              onClick={() => toggleSetting('archived')}
            />
            <HeaderMenuItem
              label="Chat wallpaper…"
              onClick={() => {
                setPickingWallpaper(true);
                setOpen(false);
              }}
            />
            <HeaderMenuItem
              label="Media, links & docs"
              onClick={() => {
                onOpenMedia();
                setOpen(false);
              }}
            />
            {conversation.type === 'group' && (
              <>
                <HeaderMenuItem
                  label="Group info"
                  onClick={() => {
                    onOpenGroupInfo();
                    setOpen(false);
                  }}
                />
                <HeaderMenuItem
                  label="Leave group"
                  danger
                  onClick={() => {
                    leave.mutate(
                      { conversationId: conversation.id, userId: myId },
                      {
                        onError: (error) =>
                          toast(
                            error instanceof ApiError ? error.message : 'Could not leave the group',
                            { kind: 'error' },
                          ),
                      },
                    );
                    setOpen(false);
                  }}
                />
              </>
            )}
          </div>
        </>
      )}

      {pickingWallpaper && (
        <Modal open onClose={() => setPickingWallpaper(false)} title="Chat wallpaper">
          <div className="grid grid-cols-3 gap-2">
            {WALLPAPERS.map((wallpaper) => (
              <button
                key={wallpaper.id}
                type="button"
                onClick={() => {
                  setWallpaper(conversation.id, wallpaper.id);
                  onWallpaperChanged();
                  setPickingWallpaper(false);
                }}
                className={`flex h-16 items-end justify-center rounded-xl border p-1 text-xs ${
                  getWallpaper(conversation.id).id === wallpaper.id
                    ? 'border-accent'
                    : 'border-border'
                }`}
                style={{ background: wallpaper.css }}
              >
                {wallpaper.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function HeaderMenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-sunken ${
        danger ? 'text-danger' : 'text-fg'
      }`}
    >
      {label}
    </button>
  );
}

// ── In-chat search (§14.12 — client-side over decrypted history) ─────────────

function SearchPanel({
  messages,
  conversation,
  myId,
  onJump,
  onClose,
}: {
  messages: MessageDto[];
  conversation: ConversationDto;
  myId: string;
  onJump: (messageId: string) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const needle = term.trim().toLowerCase();

  const matches = needle
    ? messages
        .filter((m) => !m.deletedForEveryoneAt)
        .flatMap((m) => {
          const plaintext = getCachedPlaintext(m.id);
          if (!plaintext) return [];
          const envelope = parseEnvelope(plaintext);
          const haystack =
            envelope.type === 'text'
              ? envelope.text
              : 'text' in envelope
                ? (envelope.text ?? '')
                : '';
          return haystack.toLowerCase().includes(needle) ? [{ message: m, text: haystack }] : [];
        })
        .reverse()
    : [];

  return (
    <div className="border-b border-border bg-surface-sunken px-4 py-2">
      <div className="flex items-center gap-2">
        <Input
          label="Search this conversation"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search loaded messages…"
          autoFocus
          className="h-8"
        />
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close search">
          ✕
        </Button>
      </div>
      {needle && (
        <div className="mt-1 max-h-40 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-1 py-2 text-xs text-fg-muted">
              No matches in loaded history — scroll up to load older messages, then search again.
            </p>
          ) : (
            matches.map(({ message, text }) => (
              <button
                key={message.id}
                type="button"
                onClick={() => onJump(message.id)}
                className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-raised"
              >
                <span className="font-semibold">
                  {message.senderId === myId
                    ? 'You'
                    : (conversation.members.find((m) => m.user.id === message.senderId)?.user
                        .displayName ?? '?')}
                  :
                </span>{' '}
                {text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TypingLine({ conversationId }: { conversationId: string }) {
  const typing = useSyncExternalStore(typingEmitter.subscribe, () =>
    getTypingSnapshot(conversationId),
  );
  if (typing.length === 0) return null;
  const names = typing.map((t) => t.displayName).join(', ');
  return (
    <p role="status" className="px-1 text-xs text-fg-muted italic">
      {names} {typing.length === 1 ? 'is' : 'are'} typing…
    </p>
  );
}

// ── Composer (§14.5 reply, §14.3 edit, §14.8 attachments, §14.11 drafts) ─────

const draftKey = (conversationId: string) => `pulsechat:draft:${conversationId}`;

function Composer({
  conversation,
  userId,
  mode,
  setMode,
  messagesById,
}: {
  conversation: ConversationDto;
  userId: string;
  mode: ComposerMode;
  setMode: (mode: ComposerMode) => void;
  messagesById: Map<string, MessageDto>;
}) {
  const { toast } = useToast();
  const send = useSendMessage(userId, conversation);
  const edit = useEditMessage(userId, conversation);
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey(conversation.id)) ?? '');
  const [attaching, setAttaching] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [showStickers, setShowStickers] = useState(false);
  const [annotating, setAnnotating] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<AttachmentKind>('image');
  const typingUntil = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActive = useRef(false);

  // §14.11 drafts: auto-saved per conversation, restored on return.
  useEffect(() => {
    if (mode.kind === 'edit') return;
    if (draft) localStorage.setItem(draftKey(conversation.id), draft);
    else localStorage.removeItem(draftKey(conversation.id));
  }, [draft, conversation.id, mode.kind]);

  useEffect(() => {
    if (mode.kind === 'edit') setDraft(mode.originalText);
  }, [mode]);

  function signalTyping(): void {
    const socket = getSocket();
    if (!socket?.connected) return;
    if (!typingActive.current) {
      typingActive.current = true;
      socket.emit(CLIENT_EVENTS.TYPING_START, { conversationId: conversation.id });
    }
    if (typingUntil.current) clearTimeout(typingUntil.current);
    typingUntil.current = setTimeout(stopTyping, 2500);
  }

  function stopTyping(): void {
    if (!typingActive.current) return;
    typingActive.current = false;
    getSocket()?.emit(CLIENT_EVENTS.TYPING_STOP, { conversationId: conversation.id });
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    stopTyping();
    try {
      if (mode.kind === 'edit') {
        await edit.mutateAsync({
          messageId: mode.target.id,
          plaintext: serializeEnvelope({ v: 1, type: 'text', text }),
        });
        setMode({ kind: 'normal' });
        setDraft('');
        return;
      }
      setDraft('');
      await send(serializeEnvelope({ v: 1, type: 'text', text }), {
        replyToId: mode.kind === 'reply' ? mode.target.id : undefined,
      });
      setMode({ kind: 'normal' });
    } catch (error) {
      setDraft(text);
      toast(error instanceof Error ? error.message : 'Could not send the message', {
        kind: 'error',
      });
    }
  }

  function pickFile(kind: AttachmentKind, capture = false): void {
    pendingKind.current = kind;
    const input = fileInputRef.current;
    if (!input) return;
    input.accept =
      kind === 'image'
        ? 'image/*'
        : kind === 'video'
          ? 'video/*'
          : kind === 'audio'
            ? 'audio/*'
            : '*/*';
    if (capture) input.setAttribute('capture', 'environment');
    else input.removeAttribute('capture');
    input.click();
    setAttaching(false);
  }

  async function sendAttachment(file: File): Promise<void> {
    const kind = pendingKind.current;
    try {
      setUploading(0);
      const attachment = await uploadAttachment(file, kind, setUploading);
      const envelope: MessageEnvelope = {
        v: 1,
        type: kind,
        attachment,
        ...(draft.trim() ? { text: draft.trim() } : {}),
      };
      await send(serializeEnvelope(envelope), {
        replyToId: mode.kind === 'reply' ? mode.target.id : undefined,
      });
      setDraft('');
      setMode({ kind: 'normal' });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Upload failed', { kind: 'error' });
    } finally {
      setUploading(null);
    }
  }

  function onFileChosen(file: File | undefined): void {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    // §11/§14.4 annotation step — skipped for GIFs, same rule as the
    // compression skip in uploadAttachment (keeps the animation intact).
    if (pendingKind.current === 'image' && file.type !== 'image/gif') {
      setAnnotating(file);
      return;
    }
    void sendAttachment(file);
  }

  async function sendSticker(emoji: string): Promise<void> {
    setShowStickers(false);
    try {
      await send(serializeEnvelope({ v: 1, type: 'sticker', emoji }));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not send the sticker', {
        kind: 'error',
      });
    }
  }

  const contextTarget = mode.kind === 'normal' ? null : mode.target;
  const contextLabel =
    mode.kind === 'reply' ? 'Replying to' : mode.kind === 'edit' ? 'Editing' : '';

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex flex-col gap-1 border-t border-border px-3 py-2.5"
    >
      {contextTarget && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-sunken px-2 py-1 text-xs text-fg-muted">
          <span className="truncate">
            {contextLabel}{' '}
            <ContextPreview message={messagesById.get(contextTarget.id) ?? contextTarget} />
          </span>
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => {
              setMode({ kind: 'normal' });
              if (mode.kind === 'edit') setDraft('');
            }}
            className="shrink-0 rounded px-1 hover:bg-surface-raised"
          >
            ✕
          </button>
        </div>
      )}

      {uploading !== null && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(uploading * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 overflow-hidden rounded bg-surface-sunken"
        >
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${uploading * 100}%` }}
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative">
          <button
            type="button"
            aria-label="Attach"
            title="Attach"
            aria-expanded={attaching}
            onClick={() => setAttaching(!attaching)}
            disabled={uploading !== null || mode.kind === 'edit'}
            className="h-10 rounded-xl px-2 text-lg text-fg-muted hover:bg-surface-sunken disabled:opacity-40"
          >
            📎
          </button>
          {attaching && (
            <>
              <button
                type="button"
                aria-label="Close picker"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setAttaching(false)}
              />
              <div
                role="menu"
                className="absolute bottom-full z-40 mb-1 w-40 rounded-xl border border-border bg-surface-raised p-1 shadow-lg"
              >
                <AttachOption label="📄 Document" onClick={() => pickFile('document')} />
                <AttachOption label="🖼️ Image" onClick={() => pickFile('image')} />
                <AttachOption label="🎬 Video" onClick={() => pickFile('video')} />
                <AttachOption label="🎵 Audio" onClick={() => pickFile('audio')} />
                <AttachOption label="📷 Camera" onClick={() => pickFile('image', true)} />
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            aria-label="Stickers"
            title="Stickers"
            aria-expanded={showStickers}
            onClick={() => setShowStickers(!showStickers)}
            disabled={mode.kind === 'edit'}
            className="h-10 rounded-xl px-2 text-lg text-fg-muted hover:bg-surface-sunken disabled:opacity-40"
          >
            😀
          </button>
          {showStickers && (
            <>
              <button
                type="button"
                aria-label="Close stickers"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setShowStickers(false)}
              />
              <div className="absolute bottom-full z-40 mb-1 grid w-48 grid-cols-4 gap-1 rounded-xl border border-border bg-surface-raised p-2 shadow-lg">
                {STICKERS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Send ${emoji} sticker`}
                    onClick={() => void sendSticker(emoji)}
                    className="rounded-lg p-1 text-2xl hover:bg-surface-sunken"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            signalTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e);
            }
            if (e.key === 'Escape' && mode.kind !== 'normal') {
              setMode({ kind: 'normal' });
              if (mode.kind === 'edit') setDraft('');
            }
          }}
          onBlur={stopTyping}
          rows={Math.min(4, Math.max(1, draft.split('\n').length))}
          placeholder={mode.kind === 'edit' ? 'Edit your message…' : 'Type a message…'}
          aria-label="Message"
          className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent"
        />
        <Button
          type="submit"
          size="md"
          disabled={draft.trim().length === 0 || uploading !== null}
          loading={edit.isPending}
          aria-label={mode.kind === 'edit' ? 'Save edit' : 'Send'}
        >
          {mode.kind === 'edit' ? 'Save' : 'Send'}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => onFileChosen(e.target.files?.[0])}
      />

      {annotating && (
        <ImageAnnotator
          file={annotating}
          onDone={(edited) => {
            setAnnotating(null);
            void sendAttachment(edited);
          }}
          onCancel={() => setAnnotating(null)}
        />
      )}
    </form>
  );
}

function AttachOption({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-sunken"
    >
      {label}
    </button>
  );
}

function ContextPreview({ message }: { message: MessageDto }): ReactNode {
  const plaintext = getCachedPlaintext(message.id);
  if (!plaintext) return 'a message';
  const envelope = parseEnvelope(plaintext);
  if (envelope.type === 'text') return `“${envelope.text.slice(0, 80)}”`;
  if (envelope.type === 'sticker') return `${envelope.emoji} sticker`;
  if (envelope.type === 'post-share') return '📤 shared post';
  return `📎 ${envelope.type}`;
}

// ── Forward picker (§14.5 — friends-only by construction: every conversation
// the user has is friendship-gated) ──────────────────────────────────────────

function ForwardModal({
  userId,
  source,
  sourceConversation,
  onClose,
}: {
  userId: string;
  source: MessageDto;
  sourceConversation: ConversationDto;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const conversations = useConversations();
  const sendTo = useSendToConversation(userId);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function forward(target: ConversationDto): Promise<void> {
    const plaintext = getCachedPlaintext(source.id);
    if (!plaintext) {
      toast('Decrypt the message first (scroll it into view), then forward', { kind: 'error' });
      return;
    }
    setBusyId(target.id);
    try {
      await sendTo(target, plaintext, { forwardedFromId: source.id });
      toast(`Forwarded to ${conversationTitle(target, userId)}`);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not forward', { kind: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const targets = (conversations.data?.items ?? []).filter((c) => !c.archived);

  return (
    <Modal open onClose={onClose} title="Forward to…">
      <div className="flex max-h-80 flex-col overflow-y-auto">
        {targets.length === 0 && (
          <p className="px-2 py-4 text-sm text-fg-muted">No other conversations yet.</p>
        )}
        {targets.map((target) => {
          const other = otherMember(target, userId);
          return (
            <button
              key={target.id}
              type="button"
              disabled={busyId !== null}
              onClick={() => void forward(target)}
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-sunken disabled:opacity-50"
            >
              <Avatar
                name={conversationTitle(target, userId)}
                src={target.type === 'direct' ? other?.user.avatarUrl : null}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">
                {conversationTitle(target, userId)}
                {target.id === sourceConversation.id && (
                  <span className="text-xs text-fg-muted"> (this chat)</span>
                )}
              </span>
              {busyId === target.id && (
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
