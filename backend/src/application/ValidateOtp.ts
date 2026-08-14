import { Otp } from '../domain/values/Otp';
import { OtpService } from '../domain/services/OtpService';
import { OTP_LOCKOUT_LIMIT } from '../domain/services/otpConstants';
import { ApproverGate } from './ApproverGate';
import { ApproverRepository } from './ports/ApproverRepository';
import { OtpRepository } from './ports/OtpRepository';
import { ExpiredOtpError, WrongOtpError, LockedOutError } from '../domain/errors';

export interface ValidateOtpCommand {
  requestId: string;
  token: string;
  code: unknown;
}

export interface ValidateOtpResult {
  valid: boolean;
}

/**
 * Validate an OTP use case (spec R4/R5).
 *
 * Runs the gate chain, then enforces expiry IN CODE against the stored TTL
 * value — DynamoDB TTL is cleanup, not the expiry gate (R4). A correct code is
 * compared against the stored SHA-256 digest and CONSUMED (one-time use). A
 * wrong code atomically increments the failed-attempt counter: on the 3rd
 * failure the approach's token is durably invalidated (`INVALIDATED_LOCKOUT`)
 * and even the correct code is rejected (R5). Failures → 401 with
 * `{ attemptsRemaining }`; the 3rd failure → 403.
 *
 * Pure application logic — no framework or AWS dependencies.
 */
export class ValidateOtp {
  constructor(
    private readonly gate: ApproverGate,
    private readonly approvers: ApproverRepository,
    private readonly otps: OtpRepository,
    private readonly otpService: OtpService
  ) {}

  async execute(command: ValidateOtpCommand): Promise<ValidateOtpResult> {
    const approver = await this.gate.resolve(command.requestId, command.token);
    const code = Otp.create(command.code);

    const stored = await this.otps.getOtp(command.requestId, approver.email);
    const nowEpoch = Math.floor(Date.now() / 1000);

    // In-code expiry gate: missing item OR past otpExpiresAt → expired, BEFORE
    // any code comparison. A correct code on an expired OTP is rejected (R4).
    if (!stored || stored.otpExpiresAt <= nowEpoch) {
      throw new ExpiredOtpError('The OTP is missing or expired');
    }

    const context = `${command.requestId}#${approver.email}`;
    const submittedHash = this.otpService.hash(code, context);

    if (submittedHash !== stored.otpHash) {
      const { lockedOut, attempts } = await this.approvers.incrementAttempts(
        command.requestId,
        approver.email
      );
      if (lockedOut) {
        throw new LockedOutError(
          'Approver token invalidated after repeated failed attempts',
          OTP_LOCKOUT_LIMIT - attempts
        );
      }
      throw new WrongOtpError('Incorrect code', OTP_LOCKOUT_LIMIT - attempts);
    }

    // Consume the OTP so it is single-use (R4).
    await this.otps.deleteOtp(command.requestId, approver.email);
    return { valid: true };
  }
}