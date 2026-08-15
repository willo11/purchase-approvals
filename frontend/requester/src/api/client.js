import axios from 'axios';

/**
 * Single axios instance for the requester remote (design-api "guarantee":
 * every call maps to endpoints #2/#3/#4/#5/#6).
 *
 * Dev backend runs serverless-offline on :4000 (see backend/serverless.yml).
 * The webpack DefinePlugin injects `process.env.API_BASE_URL` at build time;
 * in Jest the fallback applies because axios is mocked anyway.
 */
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

/**
 * Normalizes any failure into a component-friendly { status, message }.
 * The backend error body is `{ error, message }` (design-api `Error` shape);
 * network/timeout failures carry no response, so we synthesize a message.
 * R5: errors are surfaced, never crash the screen.
 */
export function toErrorView(error) {
  if (error?.response) {
    const { status, data } = error.response;
    const message =
      data?.message || `Request failed (${status})`;
    return { status, message };
  }
  if (error?.code === 'ECONNABORTED') {
    return { status: 0, message: 'The request timed out. Please try again.' };
  }
  return { status: 0, message: 'Network error. Please try again.' };
}
