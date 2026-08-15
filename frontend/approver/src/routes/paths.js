/**
 * Approver remote route paths. The remote owns a SINGLE entry, /approve
 * (design-api: `https://<host>/approve?request_id=<id>&approver_token=<uuid>`).
 * Two patterns resolve to the same landing page:
 *   "/approve" — standalone dev at http://localhost:3002/approve?...
 *   "/"        — composed by the host at /approve/* (the host strips the
 *                /approve prefix, so the nested routes match the remainder).
 * In both modes the page reads `request_id` + `approver_token` from the URL.
 */
export const ROUTE_PATHS = {
  approve: '/approve',
  root: '/',
};

/**
 * Build the approval link (same form the backend mails:
 * `https://<host>/approve?request_id=<id>&approver_token=<uuid>`).
 * Pure helper — used to reconstruct a demo link and covered by tests.
 */
export function buildApprovalLink(requestId, approverToken, baseUrl = '') {
  const params = new URLSearchParams();
  params.set('request_id', requestId);
  params.set('approver_token', approverToken);
  return `${baseUrl}${ROUTE_PATHS.approve}?${params.toString()}`;
}
