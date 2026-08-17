import axios from 'axios';

/**
 * Single axios instance for the approver remote (design-api "guarantee":
 * every call maps to endpoints #5/#7/#8/#9/#10/#11).
 *
 * Dev backend runs serverless-offline on :4000 (see backend/serverless.yml).
 * The webpack DefinePlugin injects `process.env.API_BASE_URL` at build time;
 * in Jest the fallback applies because axios is mocked anyway.
 */
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/dev';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

/**
 * Normalizes any failure into a component-friendly error view:
 *   { status, error, message, attemptsRemaining? }
 *
 * The backend error body is `{ error, message }` (design-api `Error` shape),
 * plus `{ attemptsRemaining }` on the OTP 401 (endpoint #8). The `error` name
 * (e.g. 'ExpiredOtpError' vs 'TerminalRequestError') lets the flow
 * distinguish same-status cases; network/timeout failures carry no response,
 * so we synthesize status 0 + a message. R5: errors are surfaced, never
 * crash the screen.
 */
export function toErrorView(error) {
  if (error?.response) {
    const { status, data } = error.response;
    return {
      status,
      error: data?.error,
      message: data?.message || `Request failed (${status})`,
      attemptsRemaining: data?.attemptsRemaining,
    };
  }
  if (error?.code === 'ECONNABORTED') {
    return {
      status: 0,
      error: 'TimeoutError',
      message: 'The request timed out. Please try again.',
    };
  }
  return {
    status: 0,
    error: 'NetworkError',
    message: 'Network error. Please try again.',
  };
}
