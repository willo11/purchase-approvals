import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useResolveApproval } from '@/hooks/useResolveApproval';
import {
  FLOW_PHASES,
  TERMINAL_VARIANTS,
  useApprovalFlowStore,
} from '@/store/useApprovalFlowStore';
import ApprovalDecisionPage from './ApprovalDecisionPage';
import OtpEntryPage from './OtpEntryPage';
import OtpLockedOutPage from './OtpLockedOutPage';
import TerminalPage from './TerminalPage';

/**
 * R1 — the single /approve entry (works standalone AND composed by the host;
 * both modes read `request_id` + `approver_token` from the URL).
 *
 * Gate-driven: resolves the link via POST .../otp (endpoint #7) and renders
 * the flow step the store is in:
 *   gate resolving   → progress copy
 *   gate failed      → alert + Try again (network/5xx — NOT a terminal state)
 *   OTP entry        → OtpEntryPage (gate passed, R1 success)
 *   decision         → ApprovalDecisionPage (OTP validated, R3)
 *   terminal         → OtpLockedOutPage (403) or TerminalPage (R1/R4)
 */
export default function ApprovalLandingPage() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('request_id');
  const approverToken = searchParams.get('approver_token');

  const phase = useApprovalFlowStore((s) => s.phase);
  const terminalVariant = useApprovalFlowStore((s) => s.terminalVariant);
  const startFlow = useApprovalFlowStore((s) => s.startFlow);

  // Carry the link params into the flow store and reset to the gate phase
  // whenever they change (a new link = a fresh flow). MUST be declared BEFORE
  // useResolveApproval so its effect runs first: resolve() can enter a
  // terminal state synchronously (missing params → invalid link), and a later
  // startFlow reset would wipe it.
  useEffect(() => {
    startFlow({ requestId, approverToken });
  }, [requestId, approverToken, startFlow]);

  const { state, error, retry } = useResolveApproval({ requestId, approverToken });

  if (phase === FLOW_PHASES.OTP) return <OtpEntryPage />;
  if (phase === FLOW_PHASES.DECISION) return <ApprovalDecisionPage />;
  if (phase === FLOW_PHASES.TERMINAL) {
    if (terminalVariant === TERMINAL_VARIANTS.LOCKED_OUT) {
      return <OtpLockedOutPage />;
    }
    return <TerminalPage />;
  }

  // Gate phase: resolving, or failed with a non-terminal error.
  if (state === 'failed' && error) {
    return (
      <Card className="mx-auto mt-10 max-w-md">
        <CardContent className="pt-6">
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <p>{error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={retry}>
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <p className="mt-10 text-center text-sm text-muted-foreground">
      Resolving your approval link...
    </p>
  );
}
