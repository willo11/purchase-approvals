import { useCallback, useState } from 'react';
import { rejectRequest } from '@/api/approvals';
import { toErrorView } from '@/api/client';
import { terminalVariantFromError } from '@/lib/flow';
import { TERMINAL_VARIANTS, useApprovalFlowStore } from '@/store/useApprovalFlowStore';

/**
 * Reject action hook (R3, task 7.3): POST .../reject with { confirm: true }
 * (endpoint #11 requires the flag — the UI gates it behind a confirmation
 * step). Success → `rejected` terminal screen (R4); terminal-gate errors →
 * the matching terminal screen; anything else surfaced inline.
 */
export function useReject() {
  const requestId = useApprovalFlowStore((s) => s.requestId);
  const approverToken = useApprovalFlowStore((s) => s.approverToken);
  const enterTerminal = useApprovalFlowStore((s) => s.enterTerminal);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const reject = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await rejectRequest(requestId, approverToken);
      enterTerminal(TERMINAL_VARIANTS.REJECTED);
    } catch (err) {
      const view = toErrorView(err);
      const variant = terminalVariantFromError(view);
      if (variant) {
        enterTerminal(variant);
      } else {
        setError(view);
      }
    } finally {
      setSubmitting(false);
    }
  }, [requestId, approverToken, enterTerminal]);

  return { submitting, error, reject };
}
