import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, toErrorView } from '@/api/client';
import { findApprovalLinkFor, isSameOrigin, listMail } from '@/api/mail';
import { getRequest, listRequests } from '@/api/requests';
import { toDetailView, toSummaryView } from '@/api/mappers';

/**
 * Approver console (`/demo`) — the demo hub's approver side.
 *
 * Click a request card → expand its 3 approvers; click an approver card →
 * resolve their real approval link from the demo inbox
 * (`GET /mock-mail?to=<email>`, matched by `request_id`) and navigate there.
 * The link ALWAYS goes through the token-gated `/approve` flow composed by the
 * host — the console never bypasses the gate, it just finds the right link.
 */
export default function DemoPage() {
  const [requests, setRequests] = useState(null);
  const [requestsError, setRequestsError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [approverError, setApproverError] = useState(null);
  const [opening, setOpening] = useState(false);

  const loadRequests = useCallback(async () => {
    setRequestsError(null);
    setRequests(null);
    try {
      const summaries = await listRequests();
      setRequests(summaries.map(toSummaryView));
    } catch (err) {
      setRequestsError(toErrorView(err));
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const selectRequest = useCallback(async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setApproverError(null);
    try {
      const detailDto = await getRequest(id);
      setDetail(toDetailView(detailDto));
    } catch (err) {
      setDetailError(toErrorView(err));
    }
  }, []);

  const openApprover = useCallback(
    async (approver) => {
      setOpening(true);
      setApproverError(null);
      try {
        const mails = await listMail(approver.email);
        const link = selectedId ? findApprovalLinkFor(mails, selectedId) : null;
        if (!link) {
          setApproverError(
            `No approval link found for ${approver.name} (${approver.email}) in this request's mail. ` +
              'Approval-link mails are sent when the request is created — check the inbox at ' +
              `${API_BASE_URL}/mock-mail?to=${encodeURIComponent(approver.email)}.`
          );
          return;
        }
        // Origin guard: the mailed link must point at THIS frontend. A stale
        // backend/.env without APPROVER_BASE_URL makes TokenIssuer default to
        // the backend origin (http://localhost:4000) — navigating there is a
        // dead page. Surface an actionable error instead of silently leaving.
        if (!isSameOrigin(link, window.location.origin)) {
          setApproverError(
            `The approval link for ${approver.name} points at ${new URL(link).origin}, ` +
              `not this console (${window.location.origin}). ` +
              'Set `APPROVER_BASE_URL=http://localhost:3000` in `backend/.env` and restart ' +
              'the backend, then reload this page.'
          );
          return;
        }
        // Hard navigation — the mailed link is the REAL token-gated flow
        // (host /approve composes the approver remote; never bypassed).
        window.location.href = link;
      } catch (err) {
        setApproverError(toErrorView(err).message);
      } finally {
        setOpening(false);
      }
    },
    [selectedId]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <section>
        <h1 className="text-2xl font-semibold">Approver console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a request, then an approver — you will land on their real OTP-gated
          approval link.
        </p>
      </section>

      {requestsError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p>{requestsError.message}</p>
          <button
            type="button"
            onClick={loadRequests}
            className="mt-2 rounded border px-3 py-1 text-xs font-medium hover:bg-destructive/10"
          >
            Try again
          </button>
        </div>
      )}

      {!requestsError && requests === null && <p>Loading requests...</p>}

      {!requestsError && requests !== null && requests.length === 0 && (
        <div className="rounded-lg border bg-card p-10 text-center">
          <p className="text-muted-foreground">
            No requests yet — create one in the requester panel.
          </p>
        </div>
      )}

      {!requestsError && requests !== null && requests.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {requests.length} request{requests.length === 1 ? '' : 's'}
          </h2>
          {requests.map((request) => (
            <button
              key={request.id}
              type="button"
              onClick={() => selectRequest(request.id)}
              aria-expanded={selectedId === request.id}
              className="flex w-full items-center justify-between rounded-lg border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md"
            >
              <span className="font-medium">{request.title}</span>
              <span className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">{request.amountLabel}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    request.status === 'COMPLETED'
                      ? 'bg-emerald-100 text-emerald-700'
                      : request.status === 'REJECTED'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-secondary text-secondary-foreground'
                  }`}
                >
                  {request.statusLabel}
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      {selectedId && detailError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Could not load the request: {detailError.message}
        </div>
      )}

      {selectedId && detail && (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Approvers for "{detail.title}"
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {detail.approvers.map((approver) => (
              <button
                key={approver.email}
                type="button"
                onClick={() => openApprover(approver)}
                disabled={opening}
                className="rounded-lg border p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md disabled:opacity-60"
              >
                <p className="font-medium">{approver.name}</p>
                <p className="text-sm text-muted-foreground">{approver.email}</p>
                <p className="mt-2 text-xs font-medium">{approver.statusLabel}</p>
              </button>
            ))}
          </div>

          {approverError && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {approverError}
            </div>
          )}

          {opening && <p className="mt-4 text-sm text-muted-foreground">Opening approval link...</p>}
        </section>
      )}
    </div>
  );
}