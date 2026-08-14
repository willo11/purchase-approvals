/**
 * Domain error hierarchy for the user-registry capability.
 *
 * These errors carry no HTTP concerns (design Decision 8: the domain knows
 * nothing about the outside world). The API layer maps each error to an HTTP
 * status code following the error→HTTP policy in design-api.md:
 *   - validation (empty name / bad email)  → 400
 *   - duplicate email                      → 409
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