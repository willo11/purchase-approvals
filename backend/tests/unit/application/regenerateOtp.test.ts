import { RegenerateOtp } from '../../../src/application/RegenerateOtp';
import { ApproverGate } from '../../../src/application/ApproverGate';
import { OtpService } from '../../../src/domain/services/OtpService';
import { OTP_TTL_SECONDS } from '../../../src/domain/services/otpConstants';
import { Otp } from '../../../src/domain/values/Otp';
import {
  LockedOutError,
  TerminalRequestError,
  UnknownTokenError,
} from '../../../src/domain/errors';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeOtpRepository } from '../helpers/fakeOtpRepository';
import { FakeMailPort } from '../helpers/fakeMailPort';
import { otpRequestDetail, activeGate } from '../helpers/otpFixture';

const CMD = { requestId: 'req-1', token: 'token-bob' };
const CONTEXT = 'req-1#bob@example.com';

function buildDeps(overrides: { attempts?: number } = {}) {
  const requests = new FakeRequestRepository();
  const approvers = new FakeApproverRepository();
  requests.seedDetail(otpRequestDetail());
  approvers.seed('req-1', activeGate({ attempts: overrides.attempts ?? 0 }));
  const otps = new FakeOtpRepository();
  const mail = new FakeMailPort();
  const useCase = new RegenerateOtp(
    new ApproverGate(requests, approvers),
    approvers,
    otps,
    new OtpService(),
    mail
  );
  return { requests, approvers, otps, mail, useCase };
}

describe('RegenerateOtp use case (spec R6)', () => {
  it('issues a fresh 3-minute OTP and resets the failed-attempt counter after an expiry', async () => {
    const { approvers, otps, mail, useCase } = buildDeps({ attempts: 1 });

    const result = await useCase.execute(CMD);

    expect(result).toEqual({ expiresInSeconds: OTP_TTL_SECONDS });

    // attempts reset to 0 (R6: "failed attempts reset to 0")
    expect(approvers.gateState('req-1', 'bob@example.com')!.attempts).toBe(0);

    // fresh OTP stored (digest only, future TTL) and mailed
    expect(otps.putCalls).toBe(1);
    expect(otps.lastPut!.otpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(otps.lastPut!.otpExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    expect(mail.sendCalls).toBe(1);
    expect(mail.events[0].type).toBe('OTP');
    const mailed = mail.events[0].otpPlain!;
    // the stored hash is the hash of the mailed code
    expect(otps.lastPut!.otpHash).toBe(
      new OtpService().hash(Otp.create(mailed), CONTEXT)
    );
  });

  it('rejects regenerate when the approver token is NOT active (lockout) → 403', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository().seed(
      'req-1',
      activeGate({ tokenStatus: 'INVALIDATED_LOCKOUT', attempts: 3 })
    );
    const otps = new FakeOtpRepository();
    const mail = new FakeMailPort();
    const useCase = new RegenerateOtp(
      new ApproverGate(requests, approvers),
      approvers,
      otps,
      new OtpService(),
      mail
    );

    await expect(useCase.execute(CMD)).rejects.toThrow(LockedOutError);
    expect(otps.putCalls).toBe(0);
    expect(mail.sendCalls).toBe(0);
  });

  it('blocks regenerate on a terminal request → 410', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail({ status: 'COMPLETED' }));
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const otps = new FakeOtpRepository();
    const useCase = new RegenerateOtp(
      new ApproverGate(requests, approvers),
      approvers,
      otps,
      new OtpService(),
      new FakeMailPort()
    );

    await expect(useCase.execute(CMD)).rejects.toThrow(TerminalRequestError);
    expect(otps.putCalls).toBe(0);
  });

  it('rejects an unknown token → 404', async () => {
    const { useCase } = buildDeps();
    await expect(
      useCase.execute({ ...CMD, token: 'bogus' })
    ).rejects.toThrow(UnknownTokenError);
  });
});