import { InvalidEmailError } from '../errors';

/**
 * Email value object — the natural key of a registered employee.
 *
 * Owns its validation invariant: an `Email` can only be constructed with a
 * value that passes format validation. Zero framework dependencies (design
 * Decision 8). Uses a pragmatic RFC-lite pattern: local@domain.tld.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  private constructor(private readonly value: string) {}

  /** Builds an Email, throwing {@link InvalidEmailError} when malformed. */
  static create(raw: unknown): Email {
    if (typeof raw !== 'string' || !EMAIL_PATTERN.test(raw.trim())) {
      throw new InvalidEmailError(`Invalid email format: ${String(raw)}`);
    }
    return new Email(raw.trim().toLowerCase());
  }

  /** True when the raw value is a structurally valid email. */
  static isValid(raw: unknown): boolean {
    return typeof raw === 'string' && EMAIL_PATTERN.test(raw.trim());
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}