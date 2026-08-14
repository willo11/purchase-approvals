import { createHash } from 'node:crypto';
import { Otp } from '../values/Otp';

/**
 * OTP domain service (spec R3/R4/R5).
 *
 * Owns OTP generation and the one-way digest used for storage/comparison. The
 * plaintext code is NEVER stored or compared — we hash `code + context`
 * (context discriminates request/approver) with SHA-256 and only ever persist
 * or compare the digest. Zero framework dependencies.
 */
export class OtpService {
  /** Generates a fresh crypto-secure 6-digit passcode. */
  generate(): Otp {
    return Otp.generate();
  }

  /**
   * Returns the SHA-256 hex digest of `${code}:${context}`. The same code in a
   * different request/approver context yields a different digest, so a leaked
   * hash cannot be replayed across approvers.
   */
  hash(otp: Otp, context: string): string {
    return createHash('sha256').update(`${otp.toString()}:${context}`).digest('hex');
  }
}