import { create } from 'zustand';

/**
 * Approver flow store — SCOPED UI state only (see frontend/DECISIONS.md #7).
 *
 * Drives the flow state machine: gate → otp → decision → terminal. The
 * BACKEND is the source of truth for all business data; this store holds only
 * what the screens need to render the correct step:
 *   - the request_id / approver_token read from the URL (carried for API calls),
 *   - the current phase + terminal variant (which screen to show),
 *   - `attemptsRemaining` (R2) and `expiresInSeconds` (R2 regenerate window).
 * The request detail itself is fetched by the decision screen and lives in
 * its local state — no business data is duplicated here.
 */
export const FLOW_PHASES = {
  GATE: 'gate',
  OTP: 'otp',
  DECISION: 'decision',
  TERMINAL: 'terminal',
};

export const TERMINAL_VARIANTS = {
  COMPLETED: 'completed',
  ALREADY_SIGNED: 'already-signed',
  ALREADY_REJECTED: 'already-rejected',
  LOCKED_OUT: 'locked-out',
  INVALID_LINK: 'invalid-link',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const initialState = {
  requestId: null,
  approverToken: null,
  phase: FLOW_PHASES.GATE,
  terminalVariant: null,
  attemptsRemaining: null,
  expiresInSeconds: null,
};

export const useApprovalFlowStore = create((set) => ({
  ...initialState,

  /** Enter the gate: a fresh link resolution starts from the gate phase. */
  startFlow: ({ requestId, approverToken }) =>
    set({
      requestId,
      approverToken,
      phase: FLOW_PHASES.GATE,
      terminalVariant: null,
      attemptsRemaining: null,
      expiresInSeconds: null,
    }),

  /** Gate passed → OTP entry (R1), with the fresh 3-minute window. */
  enterOtpEntry: ({ expiresInSeconds }) =>
    set({
      phase: FLOW_PHASES.OTP,
      expiresInSeconds,
      attemptsRemaining: null,
    }),

  /** Correct OTP → request detail + Approve/Reject (R3). */
  enterDecision: () => set({ phase: FLOW_PHASES.DECISION }),

  /** Any terminal state → informational screen, no actions (R1/R4). */
  enterTerminal: (terminalVariant) =>
    set({ phase: FLOW_PHASES.TERMINAL, terminalVariant }),

  /** R2: wrong code — the API reports how many attempts remain. */
  setAttemptsRemaining: (attemptsRemaining) => set({ attemptsRemaining }),

  /** R2: a regenerated OTP starts a FRESH window — refresh the countdown. */
  setExpiresInSeconds: (expiresInSeconds) => set({ expiresInSeconds }),
}));

/** Test helper: reset the singleton store between tests. */
export function resetApprovalFlowStore() {
  useApprovalFlowStore.setState(initialState);
}
