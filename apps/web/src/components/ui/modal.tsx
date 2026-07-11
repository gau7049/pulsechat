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
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-border bg-surface-raised p-0 text-fg shadow-xl backdrop:bg-black/50"
    >
      <div className="p-5">
        <h2 id="modal-title" className="mb-3 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
