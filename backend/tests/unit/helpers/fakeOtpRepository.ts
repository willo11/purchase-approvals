import {
  OtpRepository,
  StoredOtp,
} from '../../../src/application/ports/OtpRepository';

export interface PutRecord {
  requestId: string;
  email: string;
  otpHash: string;
  otpExpiresAt: number;
}

/**
 * In-memory fake for the {@link OtpRepository}.
 *
 * Stores `OTP#<requestId>#<email>`-style entries and records the exact put
 * payload so tests can assert hash-only storage (the digest, never the plain
 * code) and one-time consumption.
 */
export class FakeOtpRepository implements OtpRepository {
  private store = new Map<string, StoredOtp>();
  putCalls = 0;
  getCalls = 0;
  consumeCalls = 0;
  lastPut?: PutRecord;

  async putOtp(
    requestId: string,
    email: string,
    otpHash: string,
    otpExpiresAtEpochSeconds: number
  ): Promise<void> {
    this.putCalls += 1;
    this.lastPut = { requestId, email, otpHash, otpExpiresAt: otpExpiresAtEpochSeconds };
    this.store.set(`${requestId}#${email}`, {
      otpHash,
      otpExpiresAt: otpExpiresAtEpochSeconds,
    });
  }

  async getOtp(requestId: string, email: string): Promise<StoredOtp | undefined> {
    this.getCalls += 1;
    return this.store.get(`${requestId}#${email}`);
  }

  async consumeOtp(
    requestId: string,
    email: string,
    expectedHash: string,
    nowEpochSeconds: number
  ): Promise<boolean> {
    this.consumeCalls += 1;
    const key = `${requestId}#${email}`;
    const stored = this.store.get(key);
    // Mirror the real compare-and-swap DELETE: consume only if the digest
    // matches AND the code is unexpired. Otherwise (already gone / mismatch /
    // expired) the consume is refused so the code cannot validate twice.
    if (!stored || stored.otpHash !== expectedHash || stored.otpExpiresAt <= nowEpochSeconds) {
      return false;
    }
    this.store.delete(key);
    return true;
  }

  stored(requestId: string, email: string): StoredOtp | undefined {
    return this.store.get(`${requestId}#${email}`);
  }
}