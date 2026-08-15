import { useCallback, useEffect, useState } from 'react';
import { issueOtp } from '@/api/approvals';
import { toErrorView } from '@/api/client';
import { TERMINAL_VARIANTS } from '@/store/useApprovalFlowStore';
import { useApprovalFlowStore } from '@/store/useApprovalFlowStore';
import { terminalVariantFromError } from '@/lib/flow';

/**
 * Gate hook (R1, task 7.1): resolves the approval link by issuing an OTP
 * (endpoint #7). Drives the flow store:
 *   201 { expiresInSeconds } → OTP entry
 *   410 → terminal (completed / already rejected)
 *   403 → locked-out screen
 *   404 → invalid-link screen
 *   409 → already signed / already rejected terminal
 *   anything else (network/timeout/500) → `failed` state, surfaced with retry.
 */
export function useResolveApproval({ requestId, approverToken }) {
  const enterOtpEntry = useApprovalFlowStore((s) => s.enterOtpEntry);
  const enterTerminal = useApprovalFlowStore((s) => s.enterTerminal);
  const [state, setState] = useState('idle'); // idle | resolving | ready | failed
  const [error, setError] = useState(null);

  const resolve = useCallback(async () => {
    if (!requestId || !approverToken) {
      enterTerminal(TERMINAL_VARIANTS.INVALID_LINK);
      setState('ready');
      return;
    }
    setState('resolving');
    setError(null);
    try {
      const result = await issueOtp(requestId, approverToken);
      enterOtpEntry({ expiresInSeconds: result.expiresInSeconds });
      setState('ready');
    } catch (err) {
      const view = toErrorView(err);
      const variant = terminalVariantFromError(view);
      if (variant) {
        enterTerminal(variant);
        setState('ready');
      } else {
        setError(view);
        setState('failed');
      }
    }
  }, [requestId, approverToken, enterOtpEntry, enterTerminal]);

  useEffect(() => {
    resolve();
  }, [resolve]);

  return { state, error, retry: resolve };
}
