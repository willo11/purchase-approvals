import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * R3 decision controls: Approve (no name input — the registered snapshot name
 * is recorded server-side) and Reject (MUST require confirmation before the
 * { confirm: true } call fires).
 */
export default function DecisionButtons({
  onApprove,
  onRejectConfirm,
  approving = false,
  rejecting = false,
  disabled = false,
}) {
  const [confirmingReject, setConfirmingReject] = useState(false);
  const blocked = disabled || approving || rejecting;

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Button onClick={onApprove} disabled={blocked}>
          {approving ? 'Approving...' : 'Approve'}
        </Button>
        <Button
          variant="destructive"
          onClick={() => setConfirmingReject(true)}
          disabled={blocked}
        >
          Reject
        </Button>
      </div>

      {confirmingReject && (
        <div
          role="alertdialog"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <p className="font-medium">Reject this request?</p>
          <p className="mt-1 text-muted-foreground">
            This rejects the request for all approvers and cannot be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={onRejectConfirm}
              disabled={rejecting || disabled}
            >
              {rejecting ? 'Rejecting...' : 'Yes, reject'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingReject(false)}
              disabled={rejecting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
