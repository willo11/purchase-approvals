import { IssueOtp } from '../../../src/application/IssueOtp';
import { ApproverGate } from '../../../src/application/ApproverGate';
import { OtpService } from '../../../src/domain/services/OtpService';
import { OTP_TTL_SECONDS } from '../../../src/domain/services/otpConstants';
import { Otp } from '../../../src/domain/values/Otp';
import {
  UnknownRequestError,
  UnknownTokenError,
  TerminalRequestError,
  LockedOutError,
} from '../../../src/domain/errors';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeOtpRepository } from '../helpers/fakeOtpRepository';
import { FakeMailPort } from '../helpers/fakeMailPort';
import { otpRequestDetail, activeGate } from '../helpers/otpFixture';

const CMD = { requestId: 'req-1', token: 'token-bob' };

function buildDeps() {
  const requests = new FakeRequestRepository();
  const approvers = new FakeApproverRepository();
  requests.seedDetail(otpRequestDetail());
  approvers.seed('req-1', activeGate());
  const otps = new FakeOtpRepository();
  const mail = new FakeMailPort();
  const gate = new ApproverGate(requests, approvers);
  const useCase = new IssueOtp(gate, otps, new OtpService(), mail);
  return { requests, approvers, otps, mail, useCase };
}

describe('IssueOtp use case (spec R3/R7)', () => {
  it('issues a 3-minute OTP: stores ONLY the digest in the TTL item and mails the plain code', async () => {
    const { otps, mail, useCase } = buildDeps();

    const result = await useCase.execute(CMD);

    expect(result).toEqual({ expiresInSeconds: OTP_TTL_SECONDS });

    // one OTP item stored, digest only, with a future TTL
    expect(otps.putCalls).toBe(1);
    const put = otps.lastPut!;
    expect(put.requestId).toBe('req-1');
    expect(put.email).toBe('bob@example.com');
    expect(put.otpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(put.otpExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // one OTP mail mailed, disclosing the plain code only in the inbox
    expect(mail.sendCalls).toBe(1);
    expect(mail.events[0].type).toBe('OTP');
    expect(mail.events[0].to).toBe('bob@example.com');
    expect(mail.events[0].otpPlain).toMatch(/^\d{6}$/);
  });

  it('stores the hash of the exact code it mailed — the repo never sees plaintext', async () => {
    const { otps, mail, useCase } = buildDeps();

    await useCase.execute(CMD);

    const mailedCode = mail.events[0].otpPlain!;
    const context = `req-1#bob@example.com`;
    const expectedHash = new OtpService().hash(Otp.create(mailedCode), context);

    expect(otps.lastPut!.otpHash).toBe(expectedHash);
    expect(otps.lastPut!.otpHash).not.toContain(mailedCode);
    // confirm the stored row holds the hash, never the plain code
    expect(otps.stored('req-1', 'bob@example.com')!.otpHash).toBe(expectedHash);
  });

  it('does not persist or mail anything when a gate check fails', async () => {
    const { otps, mail, useCase } = buildDeps();
    await useCase.execute({ requestId: 'req-1', token: 'bogus' }).catch(() => undefined);
    expect(otps.putCalls).toBe(0);
    expect(mail.sendCalls).toBe(0);
  });
});

describe('IssueOtp gate (spec R7 precedence: terminal → lockout → token)', () => {
  it('raises TerminalRequestError (410) when the request is COMPLETED', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail({ status: 'COMPLETED' }));
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const otps = new FakeOtpRepository();
    const mail = new FakeMailPort();
    const useCase = new IssueOtp(
      new ApproverGate(requests, approvers),
      otps,
      new OtpService(),
      mail
    );

    await expect(useCase.execute(CMD)).rejects.toThrow(TerminalRequestError);
    expect(otps.putCalls).toBe(0);
    expect(mail.sendCalls).toBe(0);
  });

  it('raises TerminalRequestError (410) when the request is REJECTED (R7 scenario)', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail({ status: 'REJECTED' }));
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const useCase = new IssueOtp(
      new ApproverGate(requests, approvers),
      new FakeOtpRepository(),
      new OtpService(),
      new FakeMailPort()
    );

    await expect(useCase.execute(CMD)).rejects.toThrow(TerminalRequestError);
  });

  it('raises LockedOutError (403) when the approver token is invalidated (lockout)', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository().seed(
      'req-1',
      activeGate({ tokenStatus: 'INVALIDATED_LOCKOUT', attempts: 3 })
    );
    const useCase = new IssueOtp(
      new ApproverGate(requests, approvers),
      new FakeOtpRepository(),
      new OtpService(),
      new FakeMailPort()
    );

    await expect(useCase.execute(CMD)).rejects.toThrow(LockedOutError);
  });

  it('raises UnknownTokenError (404) when the token does not resolve to an approver', async () => {
    const { useCase } = buildDeps();
    await expect(
      useCase.execute({ requestId: 'req-1', token: 'bogus-token' })
    ).rejects.toThrow(UnknownTokenError);
  });

  it('raises UnknownRequestError (404) for an unknown request id', async () => {
    const { useCase } = buildDeps();
    await expect(
      useCase.execute({ requestId: 'no-such', token: 'token-bob' })
    ).rejects.toThrow(UnknownRequestError);
  });
});