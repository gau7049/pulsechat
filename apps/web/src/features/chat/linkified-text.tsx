import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';

/**
 * Auto-detected links with the §14.7 safety interstitial: clicking never
 * navigates directly — a dialog shows the destination and asks first.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

export function LinkifiedText({ text }: { text: string }) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const parts: Array<{ kind: 'text' | 'link'; value: string }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    if (match.index > lastIndex) {
      parts.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ kind: 'link', value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ kind: 'text', value: text.slice(lastIndex) });

  return (
    <>
      <span className="break-words whitespace-pre-wrap">
        {parts.map((part, index) =>
          part.kind === 'link' ? (
            <button
              key={index}
              type="button"
              onClick={() => setPendingUrl(part.value)}
              className="cursor-pointer font-medium underline underline-offset-2 hover:opacity-80"
            >
              {part.value}
            </button>
          ) : (
            <span key={index}>{part.value}</span>
          ),
        )}
      </span>

      {pendingUrl && (
        <Modal open onClose={() => setPendingUrl(null)} title="Leaving PulseChat">
          <p className="text-sm text-fg-muted">
            This link leads to an external site — open it only if you trust it:
          </p>
          <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm break-all text-fg">
            {pendingUrl}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingUrl(null)}>
              Stay here
            </Button>
            <Button
              onClick={() => {
                window.open(pendingUrl, '_blank', 'noopener,noreferrer');
                setPendingUrl(null);
              }}
            >
              Open link
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
