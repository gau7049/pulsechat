import { useEffect, useMemo, useState } from 'react';
import type { ConversationDto, MessageDto } from '@pulsechat/shared';
import { EmptyState } from '../../components/ui/empty-state';
import { Modal } from '../../components/ui/modal';
import { handleImageError } from '../../lib/image-fallback';
import { decryptAndCache } from './use-decrypted-message';
import { parseEnvelope, type MessageEnvelope } from './message-envelope';
import { useMessages } from './use-chat';

type GalleryItem = { message: MessageDto; envelope: Extract<MessageEnvelope, { type: string }> };
type Tab = 'media' | 'files';

/**
 * Shared media gallery (both direct and group chats): attachments live inside
 * the E2E-encrypted envelope, so the server can't index them — this fetches
 * the *entire* conversation history and decrypts it client-side to build a
 * complete Media/Files index, then caches the result for the session.
 */
export function MediaGalleryModal({
  conversation,
  userId,
  onJump,
  onClose,
}: {
  conversation: ConversationDto;
  userId: string;
  onJump: (messageId: string) => void;
  onClose: () => void;
}) {
  const messagesQuery = useMessages(conversation.id);
  const [tab, setTab] = useState<Tab>('media');
  const [scanning, setScanning] = useState(true);
  const [items, setItems] = useState<GalleryItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      setScanning(true);

      // Page through the full conversation history — bounded generously
      // rather than unbounded, so a pathological cache state can't spin forever.
      let hasNext = messagesQuery.hasNextPage;
      for (let guard = 0; hasNext && guard < 2000; guard += 1) {
        const result = await messagesQuery.fetchNextPage();
        hasNext = result.hasNextPage ?? false;
      }
      if (cancelled) return;

      const all = (messagesQuery.data?.pages ?? []).flatMap((page) => page.items);
      const found: GalleryItem[] = [];
      for (const message of all) {
        if (message.deletedForEveryoneAt) continue;
        const plaintext = await decryptAndCache(userId, conversation, message);
        if (!plaintext) continue;
        const envelope = parseEnvelope(plaintext);
        if (
          envelope.type === 'image' ||
          envelope.type === 'video' ||
          envelope.type === 'audio' ||
          envelope.type === 'document'
        ) {
          found.push({ message, envelope });
        }
      }
      if (!cancelled) {
        setItems(found.sort((a, b) => b.message.sequence - a.message.sequence));
        setScanning(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // Runs once per modal open — the conversation is fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  const media = useMemo(
    () => items.filter((i) => i.envelope.type === 'image' || i.envelope.type === 'video'),
    [items],
  );
  const files = useMemo(
    () => items.filter((i) => i.envelope.type === 'document' || i.envelope.type === 'audio'),
    [items],
  );
  const shown = tab === 'media' ? media : files;

  function jumpTo(messageId: string): void {
    onClose();
    onJump(messageId);
  }

  return (
    <Modal open onClose={onClose} title="Media, links & docs">
      <div className="flex max-h-[70vh] flex-col gap-3">
        <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
          <TabButton
            label={`Media (${media.length})`}
            active={tab === 'media'}
            onClick={() => setTab('media')}
          />
          <TabButton
            label={`Files (${files.length})`}
            active={tab === 'files'}
            onClick={() => setTab('files')}
          />
        </div>

        {scanning && (
          <p className="px-1 text-xs text-fg-muted">
            Scanning conversation history… this only happens once per chat.
          </p>
        )}

        {!scanning && shown.length === 0 && (
          <EmptyState
            icon={tab === 'media' ? '🖼️' : '📄'}
            title={tab === 'media' ? 'No media yet' : 'No files yet'}
            description="Shared photos, videos and documents will show up here."
          />
        )}

        {tab === 'media' && shown.length > 0 && (
          <div className="grid min-h-0 flex-1 grid-cols-3 gap-1 overflow-y-auto">
            {shown.map(({ message, envelope }) =>
              envelope.type === 'image' || envelope.type === 'video' ? (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => jumpTo(message.id)}
                  className="aspect-square overflow-hidden rounded-lg bg-surface-sunken"
                >
                  {envelope.type === 'image' ? (
                    <img
                      src={envelope.attachment.url}
                      alt={envelope.attachment.name}
                      onError={handleImageError}
                      className="size-full object-cover"
                    />
                  ) : (
                    <video src={envelope.attachment.url} className="size-full object-cover" muted />
                  )}
                </button>
              ) : null,
            )}
          </div>
        )}

        {tab === 'files' && shown.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shown.map(({ message, envelope }) =>
              envelope.type === 'document' || envelope.type === 'audio' ? (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => jumpTo(message.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-sunken"
                >
                  <span aria-hidden className="text-xl">
                    {envelope.type === 'audio' ? '🎵' : '📄'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {envelope.attachment.name}
                    </span>
                    <span className="block text-xs text-fg-muted">
                      {new Date(message.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              ) : null,
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-surface-raised text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
      }`}
    >
      {label}
    </button>
  );
}
