import { useCallback, useState } from 'react';
import { regenerateOtp, validateOtp } from '@/api/approvals';
import { toErrorView } from '@/api/client';
import { terminalVariantFromError } from '@/lib/flow';
import { useApprovalFlowStore } from '@/store/useApprovalFlowStore';

/**
 * OTP entry hook (R2, task 7.2): submits the 6-digit code (endpoint #8) and
 * handles every response:
 *   200 { valid: true }          → decision (request detail + Approve/Reject)
 *   401 { attemptsRemaining }    → inline error, stay on entry
 *   410 ExpiredOtpError          → `expired` state → "Generate new OTP"
 *   403 / 404 / 409 / 410 other  → terminal screen (locked out / invalid /
 *                                  already acted / completed)
 * Regenerate (endpoint #9) restarts entry with a fresh 3-minute window.
 */
export function useValidateOtp() {
  const requestId = useApprovalFlowStore((s) => s.requestId);
  const approverToken = useApprovalFlowStore((s) => s.approverToken);
  const enterDecision = useApprovalFlowStore((s) => s.enterDecision);
  const enterTerminal = useApprovalFlowStore((s) => s.enterTerminal);
  const setAttemptsRemaining = useApprovalFlowStore((s) => s.setAttemptsRemaining);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const submit = useCallback(
    async (code) => {
      setSubmitting(true);
      setError(null);
      setExpired(false);
      try {
        await validateOtp(requestId, approverToken, code);
        enterDecision();
      } catch (err) {
        const view = toErrorView(err);
        if (view.status === 401) {
          setError(view);
          setAttemptsRemaining(view.attemptsRemaining);
        } else if (view.status === 410 && view.error === 'ExpiredOtpError') {
          setExpired(true);
        } else {
          const variant = terminalVariantFromError(view);
          if (variant) {
            enterTerminal(variant);
          } else {
            setError(view);
          }
        }
      } finally {
        setSubmitting(false);
      }
    },
    [requestId, approverToken, enterDecision, enterTerminal, setAttemptsRemaining]
  );

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    setError(null);
    try {
      const result = await regenerateOtp(requestId, approverToken);
      setExpired(false);
      setAttemptsRemaining(null);
      return result.expiresInSeconds;
    } catch (err) {
      const view = toErrorView(err);
      const variant = terminalVariantFromError(view);
      if (variant) {
        enterTerminal(variant);
      } else {
        setError(view);
      }
      return null;
    } finally {
      setRegenerating(false);
    }
  }, [requestId, approverToken, enterTerminal, setAttemptsRemaining]);

  return { submitting, error, expired, regenerating, submit, regenerate };
}
