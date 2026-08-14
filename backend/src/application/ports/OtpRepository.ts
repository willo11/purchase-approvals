/**
 * A stored OTP row (design-concurrency §1 `OTP#<requestId>#<email>`).
 * Only the SHA-256 digest is persisted — never the plain code (spec R3).
 */
export interface StoredOtp {
  otpHash: string;
  /** Expiry as Unix epoch seconds, ALSO used as the DynamoDB TTL attribute. */
  otpExpiresAt: number;
}

/**
 * Persistence contract for the OTP TTL item.
 *
 * The OTP lives in its OWN TTL item (`OTP#<reqId>#<email>`, 3-min TTL) so
 * DynamoDB's TTL cleanup never touches the durable approver record
 * (design-concurrency §1/§6, Decision 4). `otpExpiresAt` is both the table TTL
 * (cleanup) and the value validated IN CODE before any comparison — the table
 * TTL is not the expiry gate (spec R4).
 */
export interface OtpRepository {
  putOtp(
    requestId: string,
    email: string,
    otpHash: string,
    otpExpiresAtEpochSeconds: number
  ): Promise<void>;

  getOtp(requestId: string, email: string): Promise<StoredOtp | undefined>;

  /**
   * Atomically consumes the OTP (one-time use, spec R4). This is a
   * compare-and-swap DELETE: it only succeeds when the stored item still holds
   * exactly `expectedHash` and has not yet expired. With concurrent identical
   * correct submissions, only ONE caller can ever win the delete — the losers
   * get `false` and are treated as already-consumed (expired), so a code can
   * never validate twice.
   */
  consumeOtp(
    requestId: string,
    email: string,
    expectedHash: string,
    nowEpochSeconds: number
  ): Promise<boolean>;
}