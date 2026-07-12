import { useState, type FormEvent } from 'react';
import type { ReportTargetType } from '@pulsechat/shared';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useToast } from '../../components/ui/toast';
import { useReport } from './use-report';

/** Reason-entry modal reused for reporting a post, message, or profile (§18). */
export function ReportModal({
  targetType,
  targetId,
  onClose,
}: {
  targetType: ReportTargetType;
  targetId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const report = useReport();
  const [reason, setReason] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    report.mutate(
      { targetType, targetId, reason: reason.trim() },
      {
        onSuccess: () => {
          toast('Report sent — thanks for flagging this', { kind: 'success' });
          onClose();
        },
        onError: () => toast('Could not send the report', { kind: 'error' }),
      },
    );
  }

  return (
    <Modal open onClose={onClose} title={`Report this ${targetType}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-fg">What's wrong?</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={1}
            maxLength={500}
            rows={4}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            placeholder="Describe the issue…"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={report.isPending}>
            Send report
          </Button>
        </div>
      </form>
    </Modal>
  );
}
