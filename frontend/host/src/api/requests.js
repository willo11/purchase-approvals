import { apiClient } from './client';

/**
 * Purchase-requests API consumed by the HOST approver console.
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