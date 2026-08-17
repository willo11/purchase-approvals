import { apiClient } from './client';

/**
 * Requests API — endpoints #3/#4/#5/#6 of design-api.md.
 * Backend shapes:
 *   RequestSummary { id, title, amount, currency, status, createdAt }
 *   RequestDetail  { id, title, description, amount, currency, status,
 *                    createdBy:{email,name}, approvers:ApproverView[],
 *                    createdAt, evidenceKey? }
 */

/** GET /api/purchase-requests → RequestSummary[] (newest first, backend-sorted). */
export async function listRequests() {
  const { data } = await apiClient.get('/api/purchase-requests');
  return data;
}

/** GET /api/purchase-requests/{id} → RequestDetail (404 when unknown). */
export async function getRequest(id) {
  const { data } = await apiClient.get(`/api/purchase-requests/${id}`);
  return data;
}

/**
 * POST /api/purchase-requests
 * Body: { title, description, amount, requesterEmail, approverEmails[3] }
 * → 201 RequestDetail; 400 validation; 404 unknown registry email.
 */
export async function createRequest(payload) {
  const { data } = await apiClient.post('/api/purchase-requests', payload);
  return data;
}

/**
 * GET /api/purchase-requests/{id}/evidence.pdf → Blob (endpoint #6).
 * Only meaningful when the request status is COMPLETED; otherwise 404.
 */
export async function downloadEvidence(id) {
  const { data } = await apiClient.get(
    `/api/purchase-requests/${id}/evidence.pdf`,
    { responseType: 'blob' }
  );
  return data;
}

/**
 * POST /api/purchase-requests/{id}/approvers/{email}/recover
 * Requester-initiated recovery of a LOCKED approver's OTP (DECISIONS #25).
 * → 201 { expiresInSeconds: 180 }; 404 unknown request/approver; 409 approver
 * not locked; 410 request terminal.
 */
export async function recoverApproverOtp(id, email) {
  const { data } = await apiClient.post(
    `/api/purchase-requests/${id}/approvers/${encodeURIComponent(email)}/recover`
  );
  return data;
}
