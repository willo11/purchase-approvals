import { randomUUID } from 'node:crypto';
import { OtpService } from '../domain/services/OtpService';
import { OTP_TTL_SECONDS, OTP_TTL_MS } from '../domain/services/otpConstants';
import { ApproverGate } from './ApproverGate';
import { ApproverRepository } from './ports/ApproverRepository';
import { OtpRepository } from './ports/OtpRepository';
import { MailPort } from './ports/MailPort';
import { LockedOutError } from '../domain/errors';

export interface RegenerateOtpCommand {
  requestId: string;
  token: string;
}

export interface RegenerateOtpResult {
  expiresInSeconds: number;
}

/**
 * Regenerate an expired OTP use case (spec R6).
 *
 * Runs the gate chain (terminal→410, lockout→403, unknown token→404), then
 * resets the failed-attempt counter ONLY while the approver token is `ACTIVE`
 * (spec R6) and issues a fresh OTP with a new 3-minute TTL, mailed through
 * {@link MailPort}. A non-`ACTIVE` token → {@link LockedOutError} (403).
 *
 * Pure application logic — no framework or AWS dependencies.
 */
export class RegenerateOtp {
  constructor(
    private readonly gate: ApproverGate,
    private readonly approvers: ApproverRepository,
    private readonly otps: OtpRepository,
    private readonly otpService: OtpService,
    private readonly mail: MailPort
  ) {}

  async execute(command: RegenerateOtpCommand): Promise<RegenerateOtpResult> {
    const approver = await this.gate.resolve(command.requestId, command.token);

    const reset = await this.approvers.resetAttemptsIfActive(
      command.requestId,
      approver.email
    );
    if (!reset) {
      // defensive: the gate already rejects INVALIDATED_LOCKOUT; this guards
      // a race where the token was invalidated between gate and reset.
      throw new LockedOutError('Approver token is invalidated (lockout)');
    }

    const otp = this.otpService.generate();
    const context = `${command.requestId}#${approver.email}`;
    const otpHash = this.otpService.hash(otp, context);
    const expiresAtEpoch = Math.floor((Date.now() + OTP_TTL_MS) / 1000);

    await this.otps.putOtp(command.requestId, approver.email, otpHash, expiresAtEpoch);

    await this.mail.send({
      id: randomUUID(),
      to: approver.email,
      type: 'OTP',
      subject: `New OTP for request ${command.requestId}`,
      body: `Your new one-time code is ${otp.toString()}. It expires in ${OTP_TTL_SECONDS} seconds.`,
      otpPlain: otp.toString(), // simulated mail only — never stored hashed
      createdAt: new Date().toISOString(),
    });

    return { expiresInSeconds: OTP_TTL_SECONDS };
  }
}