import { useCallback, useState } from 'react';
import { approveRequest } from '@/api/approvals';
import { toErrorView } from '@/api/client';
import { terminalVariantFromError } from '@/lib/flow';
import { TERMINAL_VARIANTS, useApprovalFlowStore } from '@/store/useApprovalFlowStore';

/**
 * Approve action hook (R3, task 7.3): POST .../approve with NO name input —
 * the backend records the registered snapshot name. Success → `approved`
 * terminal screen (R4); terminal-gate errors (409 already acted, 410 request
 * terminal, 403 lockout, 404) → the matching terminal screen; anything else
 * is surfaced inline without blocking the screen.
 */
export function useApprove() {
  const requestId = useApprovalFlowStore((s) => s.requestId);
  const approverToken = useApprovalFlowStore((s) => s.approverToken);
  const enterTerminal = useApprovalFlowStore((s) => s.enterTerminal);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  /** Drop a surfaced (transient) error so the decision buttons re-enable. */
  const clearError = useCallback(() => setError(null), []);

  const approve = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await approveRequest(requestId, approverToken);
      enterTerminal(TERMINAL_VARIANTS.APPROVED);
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

  return { submitting, error, approve, clearError };
}
