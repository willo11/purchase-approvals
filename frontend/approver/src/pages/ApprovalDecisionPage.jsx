import { useCallback, useEffect, useState } from 'react';
import { getRequestDetail } from '@/api/approvals';
import { toErrorView } from '@/api/client';
import { toDetailView } from '@/api/mappers';
import DecisionButtons from '@/components/DecisionButtons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApprove } from '@/hooks/useApprove';
import { useReject } from '@/hooks/useReject';
import { useApprovalFlowStore } from '@/store/useApprovalFlowStore';

/**
 * R3 — request detail + Approve/Reject.
 *
 * Fetches the request detail (endpoint #5) and shows title / description /
 * amount / requester. Approve POSTs .../approve with NO name input — the
 * backend records the registered snapshot name (spec R3). Reject goes through
 * a confirmation step and POSTs { confirm: true } (endpoint #11). Success
 * (and terminal-gate errors) move the flow to a terminal screen (R4).
 */
export default function ApprovalDecisionPage() {
  const requestId = useApprovalFlowStore((s) => s.requestId);
  const { submitting: approving, error: approveError, approve } = useApprove();
  const { submitting: rejecting, error: rejectError, reject } = useReject();

  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setDetail(null);
    try {
      const data = await getRequestDetail(requestId);
      setDetail(toDetailView(data));
    } catch (err) {
      setError(toErrorView(err));
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Card className="mx-auto mt-10 max-w-md">
        <CardContent className="pt-6">
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <p>{error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={load}>
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return <p className="mt-10 text-center text-sm">Loading request...</p>;
  }

  const actionError = approveError || rejectError;

  return (
    <div className="mx-auto mt-10 max-w-xl space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>{detail.title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {detail.description}
            </p>
          </div>
          <Badge variant="secondary">{detail.statusLabel}</Badge>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-medium">{detail.amountLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Requester</dt>
              <dd className="font-medium">{detail.requester}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">{detail.createdLabel}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Approving records the name registered for your account — no need to
            type it again. Rejecting requires confirmation.
          </p>
          <DecisionButtons
            onApprove={approve}
            onRejectConfirm={reject}
            approving={approving}
            rejecting={rejecting}
            disabled={Boolean(actionError)}
          />
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError.message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
