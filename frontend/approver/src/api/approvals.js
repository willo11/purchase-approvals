import { apiClient } from './client';

/**
 * Approver flow API — endpoints #5/#7/#8/#9/#10/#11 of design-api.md.
 * All OTP + decision endpoints live under
 *   /api/approvals/{requestId}/token/{token}
 * Backend shapes:
 *   issue/regenerate → 201 { expiresInSeconds: 180 }
 *   validate         → 200 { valid: true } | 401 { attemptsRemaining }
 *   approve/reject   → 201 RequestDetail
 *   detail (#5)      → 200 RequestDetail
 * Errors follow the design-api policy: 404 unknown, 403 lockout, 409 already
 * acted, 410 terminal/expired, 400 validation.
 */

/** POST .../otp → 201 { expiresInSeconds } (endpoint #7, the gate). */
export async function issueOtp(requestId, token) {
  const { data } = await apiClient.post(
    `/api/approvals/${requestId}/token/${token}/otp`
  );
  return data;
}

/** POST .../otp/validate { code } → 200 { valid: true } (endpoint #8). */
export async function validateOtp(requestId, token, code) {
  const { data } = await apiClient.post(
    `/api/approvals/${requestId}/token/${token}/otp/validate`,
    { code }
  );
  return data;
}

/** POST .../otp/regenerate → 201 { expiresInSeconds } (endpoint #9). */
export async function regenerateOtp(requestId, token) {
  const { data } = await apiClient.post(
    `/api/approvals/${requestId}/token/${token}/otp/regenerate`
  );
  return data;
}

/** POST .../approve → 201 RequestDetail (endpoint #10; no name input). */
export async function approveRequest(requestId, token) {
  const { data } = await apiClient.post(
    `/api/approvals/${requestId}/token/${token}/approve`
  );
  return data;
}

/** POST .../reject { confirm: true } → 201 RequestDetail (endpoint #11). */
export async function rejectRequest(requestId, token) {
  const { data } = await apiClient.post(
    `/api/approvals/${requestId}/token/${token}/reject`,
    { confirm: true }
  );
  return data;
}

/** GET /api/purchase-requests/{id} → RequestDetail (endpoint #5). */
export async function getRequestDetail(requestId) {
  const { data } = await apiClient.get(`/api/purchase-requests/${requestId}`);
  return data;
}
