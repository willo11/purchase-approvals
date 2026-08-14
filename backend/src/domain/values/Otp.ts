import { randomInt } from 'node:crypto';
import { InvalidOtpCodeError } from '../errors';

/**
 * A 6-digit numeric one-time passcode (spec R3).
 *
 * Owns its format invariant: an `Otp` can only exist as a 6-digit numeric
 * code, so an invalid code never reaches hashing or comparison. Generation
 * uses `node:crypto.randomInt` (crypto-secure, not `Math.random`). Zero
 * framework dependencies (design Decision 8).
 */
const OTP_PATTERN = /^\d{6}$/;

export class Otp {
  private constructor(private readonly value: string) {}

  /** Generates a fresh crypto-secure 6-digit passcode, zero-padded. */
  static generate(): Otp {
    return new Otp(randomInt(0, 1_000_000).toString().padStart(6, '0'));
  }

  /** Builds an Otp from a raw value, throwing when it is not 6 digits. */
  static create(raw: unknown): Otp {
    if (typeof raw !== 'string' || !OTP_PATTERN.test(raw)) {
      throw new InvalidOtpCodeError('OTP must be a 6-digit numeric code');
    }
    return new Otp(raw);
  }

  equals(other: Otp): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}