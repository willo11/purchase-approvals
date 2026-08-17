/**
 * The durable persisted view of one approver gate record (design-concurrency
 * §1 APPR row). `tokenStatus` + `attempts` carry the OTP lockout state on the
 * durable approver item — the OTP hash itself lives in a separate TTL item so
 * table TTL never deletes this record.
 */
export type ApproverTokenStatus = 'ACTIVE' | 'INVALIDATED_LOCKOUT';

export interface ApproverGateState {
  email: string;
  name: string;
  token: string;
  tokenStatus: ApproverTokenStatus;
  attempts: number;
  /** Set by a SUCCESSFUL OTP validation; required before approve/reject (spec R1/R2, 401). */
  validatedAt?: string;
  status_signed?: string;
  status_rejected?: string;
}

/** Result of an atomic failed-attempt increment. */
export interface AttemptIncrement {
  attempts: number;
  /** True when this failure reached the lockout limit (token invalidated). */
  lockedOut: boolean;
}

/**
 * Persistence contract for the durable approver item used by the OTP gate
 * chain (design-concurrency §6).
 *
 * The gate reads one REQ + the approver set to resolve a token, then mutates
 * the durable APPR row only for lockout and attempt resets. All updates are
 * conditional (compare-and-swap) so concurrent wrong submissions cannot
 * overshoot the counter or lose the lockout transition.
 */
export interface ApproverRepository {
  /** Resolves the approver row that owns `token`, or `undefined`. */
  findByToken(requestId: string, token: string): Promise<ApproverGateState | undefined>;

  /**
   * Atomically increments the failed-attempt counter while `attempts <` limit
   * and the token is still `ACTIVE`. When the counter reaches the limit it
   * durably sets `tokenStatus=INVALIDATED_LOCKOUT` so no further validation or
   * regenerate can pass (spec R5, design-concurrency §6).
   */
  incrementAttempts(requestId: string, email: string): Promise<AttemptIncrement>;

  /**
   * Resets the attempt counter ONLY while the token is `ACTIVE` (spec R6).
   * Returns `false` when the token is `INVALIDATED_LOCKOUT` (regenerate
   * rejected → 403).
   */
  resetAttemptsIfActive(requestId: string, email: string): Promise<boolean>;

  /**
   * REQUESTER-INITIATED recovery of a LOCKED approver's OTP (DECISIONS #25).
   *
   * Atomically resets an approver who is currently `INVALIDATED_LOCKOUT`:
   * sets `attempts = resetAttemptsTo`, `tokenStatus = ACTIVE`, and clears any
   * stale `validatedAt` — but ONLY while `tokenStatus = :locked`
   * (compare-and-swap, the same atomic discipline as the lockout transition).
   *
   * This is the user's explicit product rule: recovery is scoped to a LOCKED
   * approver and must NEVER silently re-issue the OTP of a non-locked
   * (innocent pending) approver. Returns `false` when the approver is not
   * currently locked (→ 409 `ApproverNotLockedError`), so a concurrent
   * recovery or a regeneration can never double-run the transition and the
   * callers of this port issue a FRESH OTP only for locked approvers.
   */
  recoverIfLocked(
    requestId: string,
    email: string,
    opts: { resetAttemptsTo: number }
  ): Promise<boolean>;

  /**
   * Durable proof that this approver validated an OTP (spec R1/R2). Called by
   * {@link ValidateOtp} on SUCCESS (only the single OTP-consume winner reaches
   * it), writing a `validatedAt` timestamp on the durable APPR row. The
   * signature use cases require the marker before approve/reject (401 when
   * missing); OTP issue/validate/regenerate do NOT require it.
   */
  markValidated(requestId: string, email: string, timestamp: string): Promise<void>;

  /**
   * Step A of an approve (design-concurrency §3): atomically records a
   * signature on this approver's durable row. A compare-and-swap
   * (`attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)`)
   * makes it per-approver idempotent — only ONE concurrent write can pass, so
   * the same approver can never sign twice (R4). `name` is the REGISTERED
   * snapshot name (R1), never typed. Returns `true` if this call recorded the
   * signature, `false` if the approver already acted (→ 409).
   */
  markSigned(
    requestId: string,
    email: string,
    signature: { name: string; timestamp: string }
  ): Promise<boolean>;

  /**
   * Step A of a reject (design-concurrency §4): atomically records a rejection
   * on this approver's durable row with the same compare-and-swap condition as
   * `markSigned`. Returns `true` if this call recorded the rejection, `false`
   * if the approver already acted (→ 409).
   */
  markRejected(
    requestId: string,
    email: string,
    signature: { name: string; timestamp: string }
  ): Promise<boolean>;
}