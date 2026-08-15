/**
 * Domain error hierarchy for the user-registry and purchase-request
 * capabilities.
 *
 * These errors carry no HTTP concerns (design Decision 8: the domain knows
 * nothing about the outside world). The API layer maps each error to an HTTP
 * status code following the error→HTTP policy in design-api.md:
 *   - validation (empty name / bad email / bad amount / wrong approver set) → 400
 *   - duplicate email                                                       → 409
 *   - unknown registry / request                                            → 404
 *   - domain conflict (already acted, terminal)                             → 409/410
 */

/** Base class for all domain errors raised by the user-registry core. */
export abstract class UserDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Raised when the registered name is an empty string (or whitespace-only). */
export class EmptyNameError extends UserDomainError {}

/** Raised when a payload email does not match a valid email format. */
export class InvalidEmailError extends UserDomainError {}

/**
 * Raised when a registration collides with an existing email natural key.
 * Surfaced by the repository when the conditional PutItem overwrite-guard
 * (`attribute_not_exists(PK)`) fails, so no duplicate is ever persisted.
 */
export class UserAlreadyExistsError extends UserDomainError {}

/**
 * Base class for all domain errors raised by the purchase-request core.
 *
 * Validation subclasses map to HTTP 400; the "unknown" subclasses map to 404
 * at the API boundary (design-api policy).
 */
export abstract class PurchaseRequestDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Raised when the request title is empty (or whitespace-only). */
export class EmptyTitleError extends PurchaseRequestDomainError {}

/** Raised when the request description is empty (or whitespace-only). */
export class EmptyDescriptionError extends PurchaseRequestDomainError {}

/** Raised when the amount is not a positive number, or has >2 decimal places. */
export class InvalidAmountError extends PurchaseRequestDomainError {}

/** Raised when the approver list is not exactly 3 emails. */
export class InvalidApproverCountError extends PurchaseRequestDomainError {}

/** Raised when the same email appears more than once among the 3 approvers. */
export class DuplicateApproverError extends PurchaseRequestDomainError {}

/** Raised when the requester email is also one of the supporting roles. */
export class RequesterIsApproverError extends PurchaseRequestDomainError {}

/**
 * Raised when a requester or approver email is not present in the user
 * registry. Mapped to HTTP 404 at the API boundary (design-api policy:
 * "Unknown registry emails").
 */
export class UnknownUserError extends PurchaseRequestDomainError {}

/** Raised when a request id does not exist. Mapped to HTTP 404. */
export class UnknownRequestError extends PurchaseRequestDomainError {}

/**
 * Raised when an OTP submitted for validation is not a 6-digit numeric code.
 * Mapped to HTTP 400 at the API boundary (design-api policy).
 */
export class InvalidOtpCodeError extends PurchaseRequestDomainError {}

/**
 * Raised when an action is attempted with a token that does not resolve to an
 * approver record of a request. Mapped to HTTP 404 (design-api "Unknown/expired
 * token").
 */
export class UnknownTokenError extends PurchaseRequestDomainError {}

/**
 * Raised when the request is already terminal (`COMPLETED` / `REJECTED`) so no
 * OTP flow may proceed. Mapped to HTTP 410 (design-concurrency §2 gate 1).
 */
export class TerminalRequestError extends PurchaseRequestDomainError {}

/**
 * Raised when the approver token is `INVALIDATED_LOCKOUT`. Mapped to HTTP 403
 * with `attemptsRemaining: 0` when a failure triggered it, plain 403 otherwise
 * (design-concurrency §2 gate 2).
 */
export class LockedOutError extends PurchaseRequestDomainError {
  constructor(
    message: string,
    public readonly attemptsRemaining = 0
  ) {
    super(message);
  }
}

/**
 * Raised when a submitted OTP is wrong. Mapped to HTTP 401 with the payload
 * `{ attemptsRemaining }` (design-api policy).
 */
export class WrongOtpError extends PurchaseRequestDomainError {
  constructor(
    message: string,
    public readonly attemptsRemaining: number
  ) {
    super(message);
  }
}

/**
 * Raised when the current OTP is missing or past its `otpExpiresAt` even though
 * the DynamoDB TTL has not fired yet. Mapped to HTTP 410 (expiry validated in
 * code; TTL is only cleanup — design-concurrency §6, spec R4).
 */
export class ExpiredOtpError extends PurchaseRequestDomainError {}

/**
 * Raised when an approver tries to act (approve/reject) after already having
 * signed or rejected the request, or (via the shared gate) re-enters the OTP
 * flow after acting. Mapped to HTTP 409 ("already acted", design-api policy —
 * the 4th gate check added for the signature capability).
 */
export class AlreadyActedError extends PurchaseRequestDomainError {}