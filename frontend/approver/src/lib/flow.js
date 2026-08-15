/**
 * Approver flow state machine helpers (task 7.5): maps the backend's
 * error→HTTP policy (design-api.md) to a terminal screen variant. Pure —
 * no React, no axios, fully unit-testable.
 *
 * The gate chain is: terminal global state (410) → lockout (403) → unknown
 * token/request (404) → already acted (409). The OTP endpoints reuse the
 * same shared gate, so a single classifier drives every terminal screen:
 *
 *   404 → invalid link (unknown request or token)
 *   403 → locked out (token invalidated after 3 wrong codes)
 *   409 → already signed / already rejected (approver acted before)
 *   410 → completed / already rejected (request terminal) — EXCEPT the
 *         ExpiredOtpError name, which means "generate a new OTP" (R2) and is
 *         handled by the OTP entry screen, not as a terminal variant.
 *
 * NOTE (message coupling pin): the 409 signed-vs-rejected and 410
 * COMPLETED-vs-REJECTED discriminators regex the backend's stable English
 * `message` strings, and `error` compares against the backend's error-class
 * NAMES. Both are PINNED by backend handler contract tests — see
 * `backend/tests/unit/api/otp.test.ts` ("error body contract pinned for the
 * approver classifier") and `backend/tests/unit/api/signature.test.ts`
 * ("signature error body contract pinned"). If the backend rewords the
 * messages, those tests fail before any frontend screen can break silently.
 */
export const TERMINAL_VARIANTS = {
  COMPLETED: 'completed',
  ALREADY_SIGNED: 'already-signed',
  ALREADY_REJECTED: 'already-rejected',
  LOCKED_OUT: 'locked-out',
  INVALID_LINK: 'invalid-link',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/**
 * Classify a normalized error view ({ status, error, message }) into a
 * terminal variant, or null when the error does not imply a terminal state
 * (e.g. status 0 network errors, 401 wrong OTP, 500 — those are surfaced
 * inline with retry instead).
 */
export function terminalVariantFromError({ status, message, error } = {}) {
  if (status === 403) return TERMINAL_VARIANTS.LOCKED_OUT;
  if (status === 404) return TERMINAL_VARIANTS.INVALID_LINK;
  if (status === 409) {
    // AlreadyActedError message: "This approver already signed|rejected..."
    return /signed/i.test(message || '')
      ? TERMINAL_VARIANTS.ALREADY_SIGNED
      : TERMINAL_VARIANTS.ALREADY_REJECTED;
  }
  if (status === 410) {
    // TerminalRequestError message: "Request <id> is already COMPLETED|REJECTED".
    // ExpiredOtpError ("The OTP is missing or expired") is NOT terminal — the
    // OTP entry screen offers regeneration (R2).
    if (error === 'ExpiredOtpError') return null;
    return /rejected/i.test(message || '')
      ? TERMINAL_VARIANTS.ALREADY_REJECTED
      : TERMINAL_VARIANTS.COMPLETED;
  }
  return null;
}

/**
 * True for failures that are NOT terminal and SHOULD be retryable: network /
 * timeout (status 0 from toErrorView) and 5xx server errors. Used by the
 * decision page to offer a "Try again" affordance instead of leaving the
 * Approve/Reject buttons dead after a transient failure. 4xx validation /
 * auth errors are NOT retryable here (they mean the request was rejected).
 */
export function isTransientError({ status } = {}) {
  return status === 0 || status >= 500;
}
