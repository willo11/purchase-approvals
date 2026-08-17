import { OtpService } from '../../../src/domain/services/OtpService';
import { OTP_TTL_SECONDS } from '../../../src/domain/services/otpConstants';
import { Otp } from '../../../src/domain/values/Otp';
import { RecoverApproverOtp } from '../../../src/application/RecoverApproverOtp';
import {
  ApproverNotLockedError,
  TerminalRequestError,
  UnknownRequestError,
  UnknownApproverError,
} from '../../../src/domain/errors';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeOtpRepository } from '../helpers/fakeOtpRepository';
import { FakeMailPort } from '../helpers/fakeMailPort';
import { otpRequestDetail } from '../helpers/otpFixture';

const CMD = { requestId: 'req-1', email: 'bob@example.com' };
const CONTEXT = 'req-1#bob@example.com';

/**
 * Builds the use case with bob LOCKED (`tokenStatus=INVALIDATED_LOCKOUT`).
 * `locked` controls whether the seeded approver gate state is locked.
 */
function buildDeps({ locked = true, status }: { locked?: boolean; status?: 'PENDING' | 'COMPLETED' | 'REJECTED' } = {}) {
  const requests = new FakeRequestRepository().seedDetail(
    otpRequestDetail(status ? { status } : {})
  );
  const approvers = new FakeApproverRepository().seed(
    'req-1',
    locked
      ? {
          email: 'bob@example.com',
          name: 'Bob',
          token: 'token-bob',
          tokenStatus: 'INVALIDATED_LOCKOUT',
          attempts: 3,
        }
      : {
          email: 'bob@example.com',
          name: 'Bob',
          token: 'token-bob',
          tokenStatus: 'ACTIVE',
          attempts: 1,
        }
  );
  const otps = new FakeOtpRepository();
  const mail = new FakeMailPort();
  const useCase = new RecoverApproverOtp(requests, approvers, otps, new OtpService(), mail);
  return { requests, approvers, otps, mail, useCase };
}

describe('RecoverApproverOtp use case (DECISIONS #25)', () => {
  it('recovers a LOCKED approver: resets attempts, issues a fresh 3-minute OTP, mails it → 201', async () => {
    const { approvers, otps, mail, useCase } = buildDeps();

    const result = await useCase.execute(CMD);

    expect(result).toEqual({ expiresInSeconds: OTP_TTL_SECONDS });

    // the locked approver is now ACTIVE with attempts reset to 0
    const state = approvers.gateState('req-1', 'bob@example.com')!;
    expect(state.tokenStatus).toBe('ACTIVE');
    expect(state.attempts).toBe(0);

    // a FRESH OTP was stored (digest only) and mailed — the approver is told
    expect(otps.putCalls).toBe(1);
    expect(otps.lastPut!.otpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(otps.lastPut!.otpExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(mail.sendCalls).toBe(1);
    expect(mail.events[0].type).toBe('OTP');
    expect(mail.events[0].to).toBe('bob@example.com');
    // the stored hash is the hash of the newly mailed code
    expect(otps.lastPut!.otpHash).toBe(
      new OtpService().hash(Otp.create(mail.events[0].otpPlain!), CONTEXT)
    );
  });

  it('rejects recovery of a NON-locked (innocent pending) approver → 409 and issues NO OTP / NO mail', async () => {
    const { approvers, otps, mail, useCase } = buildDeps({ locked: false });

    await expect(useCase.execute(CMD)).rejects.toThrow(ApproverNotLockedError);
    // the innocent approver is untouched: still ACTIVE, attempts unchanged
    const state = approvers.gateState('req-1', 'bob@example.com')!;
    expect(state.tokenStatus).toBe('ACTIVE');
    expect(state.attempts).toBe(1);
    // NO OTP issued, NO mail sent — an innocent pending approver's OTP is never
    // changed by an action they don't control
    expect(otps.putCalls).toBe(0);
    expect(mail.sendCalls).toBe(0);
  });

  it('blocks recovery on a terminal (COMPLETED) request → 410', async () => {
    const { otps, mail, useCase } = buildDeps({ status: 'COMPLETED' });

    await expect(useCase.execute(CMD)).rejects.toThrow(TerminalRequestError);
    expect(otps.putCalls).toBe(0);
    expect(mail.sendCalls).toBe(0);
  });

  it('blocks recovery on a REJECTED request → 410', async () => {
    const { useCase } = buildDeps({ status: 'REJECTED' });
    await expect(useCase.execute(CMD)).rejects.toThrow(TerminalRequestError);
  });

  it('returns UnknownRequestError → 404 for an unknown request', async () => {
    const requests = new FakeRequestRepository();
    const approvers = new FakeApproverRepository();
    const otps = new FakeOtpRepository();
    const useCase = new RecoverApproverOtp(
      requests,
      approvers,
      otps,
      new OtpService(),
      new FakeMailPort()
    );

    await expect(useCase.execute(CMD)).rejects.toThrow(UnknownRequestError);
    expect(otps.putCalls).toBe(0);
  });

  it('returns UnknownApproverError → 404 when the email is not an approver of the request', async () => {
    const requests = new FakeRequestRepository().seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository();
    const otps = new FakeOtpRepository();
    const useCase = new RecoverApproverOtp(
      requests,
      approvers,
      otps,
      new OtpService(),
      new FakeMailPort()
    );

    await expect(
      useCase.execute({ requestId: 'req-1', email: 'nobody@example.com' })
    ).rejects.toThrow(UnknownApproverError);
    expect(otps.putCalls).toBe(0);
  });

  it('single-winner recovery under concurrency: only ONE recover wins the CAS, one fresh OTP is issued', async () => {
    const { approvers, otps, mail, useCase } = buildDeps();

    // first recover wins — the locked approver becomes ACTIVE
    await expect(useCase.execute(CMD)).resolves.toEqual({ expiresInSeconds: OTP_TTL_SECONDS });
    expect(approvers.gateState('req-1', 'bob@example.com')!.tokenStatus).toBe('ACTIVE');
    expect(otps.putCalls).toBe(1);

    // a second (concurrent) recover on the now-ACTIVE approver loses the CAS → 409,
    // and issues NO additional OTP / mail
    await expect(useCase.execute(CMD)).rejects.toThrow(ApproverNotLockedError);
    expect(otps.putCalls).toBe(1);
    expect(mail.sendCalls).toBe(1);
  });
});
