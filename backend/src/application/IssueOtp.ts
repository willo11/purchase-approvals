import { randomUUID } from 'node:crypto';
import { OtpService } from '../domain/services/OtpService';
import { OTP_TTL_SECONDS, OTP_TTL_MS } from '../domain/services/otpConstants';
import { ApproverGate } from './ApproverGate';
import { OtpRepository } from './ports/OtpRepository';
import { MailPort } from './ports/MailPort';

export interface IssueOtpCommand {
  requestId: string;
  token: string;
}

export interface IssueOtpResult {
  expiresInSeconds: number;
}

/**
 * Issue an OTP use case (spec R3/R7).
 *
 * Runs {@link ApproverGate} (terminal→410, lockout→403, unknown token→404),
 * then generates a fresh 6-digit code, stores ONLY its SHA-256 digest in the
 * TTL `OTP#<requestId>#<email>` item (3-min `otpExpiresAt`), and "sends" the
 * OTP through {@link MailPort} (which discloses the plain code for demo/QA in
 * the simulated inbox). Returns `201 { expiresInSeconds: 180 }`.
 *
 * Pure application logic — no framework or AWS dependencies.
 */
export class IssueOtp {
  constructor(
    private readonly gate: ApproverGate,
    private readonly otps: OtpRepository,
    private readonly otpService: OtpService,
    private readonly mail: MailPort
  ) {}

  async execute(command: IssueOtpCommand): Promise<IssueOtpResult> {
    const approver = await this.gate.resolve(command.requestId, command.token);

    const otp = this.otpService.generate();
    const context = `${command.requestId}#${approver.email}`;
    const otpHash = this.otpService.hash(otp, context);
    const expiresAtEpoch = Math.floor((Date.now() + OTP_TTL_MS) / 1000);

    await this.otps.putOtp(command.requestId, approver.email, otpHash, expiresAtEpoch);

    await this.mail.send({
      id: randomUUID(),
      to: approver.email,
      type: 'OTP',
      subject: `OTP for request ${command.requestId}`,
      body: `Your one-time code is ${otp.toString()}. It expires in ${OTP_TTL_SECONDS} seconds.`,
      otpPlain: otp.toString(), // simulated mail only — never stored hashed
      createdAt: new Date().toISOString(),
    });

    return { expiresInSeconds: OTP_TTL_SECONDS };
  }
}