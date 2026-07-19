import { useEffect, useRef, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Dialog primitive on top of the native <dialog> element — focus trapping,
 * Escape handling, and inertness of the page behind come from the platform.
 */
export function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        // Click on the backdrop (the dialog element itself) dismisses.
        if (event.target === dialogRef.current) onClose();
      }}
      aria-labelledby="modal-title"
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-border bg-surface-raised p-0 text-fg shadow-xl backdrop:bg-black/50 max-sm:mt-auto max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-[20px] max-sm:border-x-0 max-sm:border-b-0"
    >
      <div className="p-5">
        {/* Grab handle — mobile renders dialogs as bottom sheets (frames N1/N7/N10). */}
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" />
        <h2 id="modal-title" className="mb-3 text-lg font-bold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
