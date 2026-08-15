import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TERMINAL_VARIANTS, useApprovalFlowStore } from '@/store/useApprovalFlowStore';

/**
 * R4 + R1: informational terminal screens with NO actions. The variant comes
 * from the flow store (driven by the gate/decision error codes — see
 * lib/flow.js):
 *   completed        — request COMPLETED by all approvers (410)
 *   already-signed   — this approver already signed (409)
 *   already-rejected — request rejected, or this approver already rejected
 *                       (409 / 410)
 *   approved         — this approver just approved (201)
 *   rejected         — this approver just rejected (201)
 *   invalid-link     — unknown request/token or missing params (404)
 */
export const TERMINAL_COPY = {
  [TERMINAL_VARIANTS.COMPLETED]: {
    title: 'Request Completed',
    message:
      'This purchase request has been completed by all approvers. No further action is needed.',
  },
  [TERMINAL_VARIANTS.ALREADY_SIGNED]: {
    title: 'Already Signed',
    message: 'You have already signed this request. No further action is needed.',
  },
  [TERMINAL_VARIANTS.ALREADY_REJECTED]: {
    title: 'Request Rejected',
    message: 'This request has been rejected. No further action is needed.',
  },
  [TERMINAL_VARIANTS.INVALID_LINK]: {
    title: 'Invalid Link',
    message:
      'This approval link is invalid or incomplete. Please use the link from your email.',
  },
  [TERMINAL_VARIANTS.APPROVED]: {
    title: 'Request Approved',
    message: 'Your approval has been recorded. Thank you.',
  },
  [TERMINAL_VARIANTS.REJECTED]: {
    title: 'Request Rejected',
    message: 'Your rejection has been recorded. Thank you.',
  },
};

const FALLBACK_COPY = {
  title: 'Approval Flow',
  message: 'No further action is needed.',
};

export default function TerminalPage() {
  const terminalVariant = useApprovalFlowStore((s) => s.terminalVariant);
  const copy = TERMINAL_COPY[terminalVariant] ?? FALLBACK_COPY;

  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{copy.message}</p>
      </CardContent>
    </Card>
  );
}
