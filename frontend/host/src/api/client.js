import axios from 'axios';

/**
 * Single axios instance for the HOST app (the shell reads backend data for the
 * demo hub + approver console; the remotes keep their own instances).
 *
 * Dev backend runs serverless-offline on :4000 (see backend/serverless.yml).
 * The webpack DefinePlugin replaces this `process.env.API_BASE_URL` with its
 * literal at build time (same as requester/approver), so the emitted bundle
 * never references `process` at runtime — the browser has no such object.
 * In Jest the fallback applies because axios is mocked anyway.
 */
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/dev';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

/**
 * Normalizes any failure into a component-friendly { status, message }.
 * The backend error body is `{ error, message }`; network/timeout failures
 * carry no response, so we synthesize a message. Errors are surfaced, never
 * crash a screen.
 */
export function toErrorView(error) {
  if (error?.response) {
    const { status, data } = error.response;
    const message = data?.message || `Request failed (${status})`;
    return { status, message };
  }
  if (error?.code === 'ECONNABORTED') {
    return { status: 0, message: 'The request timed out. Please try again.' };
  }
  return { status: 0, message: 'Network error. Please try again.' };
}