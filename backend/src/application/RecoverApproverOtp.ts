import { randomUUID } from 'node:crypto';
import { OtpService } from '../domain/services/OtpService';
import { OTP_TTL_SECONDS, OTP_TTL_MS } from '../domain/services/otpConstants';
import { GlobalStatus } from '../domain/enums/GlobalStatus';
import { ApproverRepository } from './ports/ApproverRepository';
import { OtpRepository } from './ports/OtpRepository';
import { MailPort } from './ports/MailPort';
import { RequestRepository } from './ports/RequestRepository';
import {
  UnknownRequestError,
  UnknownApproverError,
  TerminalRequestError,
  ApproverNotLockedError,
} from '../domain/errors';

export interface RecoverApproverOtpCommand {
  requestId: string;
  email: string;
}

export interface RecoverApproverOtpResult {
  expiresInSeconds: number;
}

/**
 * REQUESTER-INITIATED recovery of a LOCKED approver's OTP (DECISIONS #25).
 *
 * A locked approver (3 failed OTP attempts → `tokenStatus=INVALIDATED_LOCKOUT`)
 * has no self-service path — the intent is "lockout prevents brute-force;
 * recovery is an authorized requester/owner action, NOT self-service". This
 * use case lets the OWNER reset a locked approver and issue them a FRESH OTP
 * (a new code they ARE told about, via {@link MailPort}).
 *
 * Scope discipline (the user's explicit product rule, do NOT weaken):
 * recovery is ONLY for a LOCKED approver. A non-locked (innocent pending)
 * approver must NEVER have their OTP changed by an action they don't control —
 * so `recoverIfLocked` compare-and-swaps on `tokenStatus=INVALIDATED_LOCKOUT`
 * and this use case maps a miss to {@link ApproverNotLockedError} (409).
 *
 * Gate chain: request exists (404) → global state not terminal (410) →
 * approver present (404) → approver IS locked (409 otherwise).
 *
 * Pure application logic — no framework or AWS dependencies.
 */
export class RecoverApproverOtp {
  constructor(
    private readonly requests: RequestRepository,
    private readonly approvers: ApproverRepository,
    private readonly otps: OtpRepository,
    private readonly otpService: OtpService,
    private readonly mail: MailPort
  ) {}

  async execute(command: RecoverApproverOtpCommand): Promise<RecoverApproverOtpResult> {
    const detail = await this.requests.get(command.requestId);
    if (!detail) {
      throw new UnknownRequestError(`Request ${command.requestId} not found`);
    }
    if (
      detail.status === GlobalStatus.COMPLETED ||
      detail.status === GlobalStatus.REJECTED
    ) {
      throw new TerminalRequestError(
        `Request ${command.requestId} is already ${detail.status}; no recovery is offered`
      );
    }
    if (!detail.approvers.some((a) => a.email === command.email)) {
      throw new UnknownApproverError(
        `Approver ${command.email} is not part of request ${command.requestId}`
      );
    }

    // Recover ONLY if this approver is currently LOCKED. This is a conditional
    // compare-and-swap: only ONE concurrent recovery wins, and a non-locked
    // (innocent pending) approver returns false → 409 with NO OTP issued and NO
    // mail sent.
    const recovered = await this.approvers.recoverIfLocked(command.requestId, command.email, {
      resetAttemptsTo: 0,
    });
    if (!recovered) {
      throw new ApproverNotLockedError(
        'Approver OTP recovery is only available for a LOCKED approver'
      );
    }

    // TRANSIENT WINDOW (non-blocking, acknowledged): `recoverIfLocked` has
    // already flipped this approver from `INVALIDATED_LOCKOUT` → `ACTIVE`, but
    // the fresh OTP below is not written yet. In that microscopic window, an
    // in-flight validation carrying the OLD code could briefly succeed (the
    // gate no longer sees a lockout and the old `OTP#...` TTL item still holds
    // the old digest). Scope: this only ever affects the ALREADY-LOCKED approver
    // — never an innocent pending one — so it does not violate the product rule.
    // The fresh `putOtp` below immediately replaces the old code.

    // NON-TRANSACTIONAL RECOVERY (non-blocking, acknowledged): this is a
    // 3-step sequence (CAS → putOtp → mail), not a single transaction. A
    // failure between the CAS and `putOtp` leaves an ACTIVE approver with no
    // fresh code → the handler returns 500 and the requester retries (the CAS
    // now fails the `tokenStatus = :locked` condition, so retry is a no-op that
    // re-issues nothing until the approver is locked again). Harmless to the
    // locked-only rule; a transactional path would be a DynamoDB TransactWrite
    // spanning two items, which is out of scope for this demo build.

    // Issue a FRESH OTP so the recovered approver has a new code they're told
    // about (via mail) — consistent with the "the approver is notified" intent.
    const otp = this.otpService.generate();
    const context = `${command.requestId}#${command.email}`;
    const otpHash = this.otpService.hash(otp, context);
    const expiresAtEpoch = Math.floor((Date.now() + OTP_TTL_MS) / 1000);

    await this.otps.putOtp(command.requestId, command.email, otpHash, expiresAtEpoch);

    await this.mail.send({
      id: randomUUID(),
      to: command.email,
      type: 'OTP',
      subject: `New OTP for request ${command.requestId}`,
      body: `Your one-time code is ${otp.toString()}. It expires in ${OTP_TTL_SECONDS} seconds.`,
      otpPlain: otp.toString(), // simulated mail only — never stored hashed
      createdAt: new Date().toISOString(),
    });

    return { expiresInSeconds: OTP_TTL_SECONDS };
  }
}
