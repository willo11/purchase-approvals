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
  deleteCalls = 0;
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

  async deleteOtp(requestId: string, email: string): Promise<void> {
    this.deleteCalls += 1;
    this.store.delete(`${requestId}#${email}`);
  }

  stored(requestId: string, email: string): StoredOtp | undefined {
    return this.store.get(`${requestId}#${email}`);
  }
}