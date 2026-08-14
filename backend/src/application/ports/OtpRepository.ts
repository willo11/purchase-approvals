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

  /** Consumes the OTP (one-time use) on a successful validation (spec R4). */
  deleteOtp(requestId: string, email: string): Promise<void>;
}