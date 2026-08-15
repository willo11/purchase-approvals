import { ValidateOtp } from '../../../src/application/ValidateOtp';
import { ApproverGate } from '../../../src/application/ApproverGate';
import { OtpService } from '../../../src/domain/services/OtpService';
import { Otp } from '../../../src/domain/values/Otp';
import {
  ExpiredOtpError,
  WrongOtpError,
  LockedOutError,
  InvalidOtpCodeError,
  TerminalRequestError,
  UnknownTokenError,
} from '../../../src/domain/errors';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeOtpRepository } from '../helpers/fakeOtpRepository';
import { otpRequestDetail, activeGate } from '../helpers/otpFixture';

const CMD = { requestId: 'req-1', token: 'token-bob', code: '123456' };
const CONTEXT = 'req-1#bob@example.com';

function seedStoredCode(otps: FakeOtpRepository, code: string, expiresInFuture = true) {
  const service = new OtpService();
  otps.putOtp(
    'req-1',
    'bob@example.com',
    service.hash(Otp.create(code), CONTEXT),
    expiresInFuture
      ? Math.floor(Date.now() / 1000) + 180
      : Math.floor(Date.now() / 1000) - 60 // already expired, record still present
  );
}

function buildDeps(overrides: { attempts?: number } = {}) {
  const requests = new FakeRequestRepository();
  const approvers = new FakeApproverRepository();
  requests.seedDetail(otpRequestDetail());
  approvers.seed(
    'req-1',
    activeGate({ attempts: overrides.attempts ?? 0 })
  );
  const otps = new FakeOtpRepository();
  const gate = new ApproverGate(requests, approvers);
  const useCase = new ValidateOtp(gate, approvers, otps, new OtpService());
  return { requests, approvers, otps, useCase };
}

describe('ValidateOtp use case (spec R4)', () => {
  it('validates a correct unexpired code and consumes the OTP (one-time use)', async () => {
    const { approvers, otps, useCase } = buildDeps();
    seedStoredCode(otps, '123456');

    const result = await useCase.execute(CMD);

    expect(result).toEqual({ valid: true });
    // OTP consumed via the atomic compare-and-swap consume
    expect(otps.consumeCalls).toBe(1);
    expect(otps.stored('req-1', 'bob@example.com')).toBeUndefined();

    // success durably marks the approver validated (precondition for
    // approve/reject, spec R1/R2)
    expect(approvers.markValidatedCalls).toBe(1);
    expect(
      approvers.gateState('req-1', 'bob@example.com')?.validatedAt
    ).toEqual(expect.any(String));

    // a second validation of the same code now fails as expired (consumed)
    await expect(useCase.execute(CMD)).rejects.toThrow(ExpiredOtpError);
    expect(otps.consumeCalls).toBe(1); // no new consume succeeds
  });

  it('rejects a correct code when the OTP is expired IN CODE even before TTL cleanup (R4)', async () => {
    const { otps, useCase } = buildDeps();
    seedStoredCode(otps, '123456', false); // expiresAt in the past, row still exists

    await expect(useCase.execute(CMD)).rejects.toThrow(ExpiredOtpError);
    expect(otps.consumeCalls).toBe(0); // not consumed
  });

  it('rejects a malformed code with InvalidOtpCodeError (→400)', async () => {
    const { otps, useCase } = buildDeps();
    seedStoredCode(otps, '123456');

    await expect(
      useCase.execute({ ...CMD, code: '12ab' })
    ).rejects.toThrow(InvalidOtpCodeError);
  });
});

describe('ValidateOtp failed attempts & lockout (spec R5)', () => {
  it('returns attemptsRemaining after a wrong code and does NOT consume the valid OTP', async () => {
    const { approvers, otps, useCase } = buildDeps();
    seedStoredCode(otps, '123456');

    try {
      await useCase.execute({ ...CMD, code: '000000' });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(WrongOtpError);
      expect((err as WrongOtpError).attemptsRemaining).toBe(2);
    }
    expect(approvers.gateState('req-1', 'bob@example.com')!.attempts).toBe(1);
    expect(otps.stored('req-1', 'bob@example.com')).toBeDefined(); // OTP not consumed
  });

  it('atomically locks out on the 3rd consecutive failure and then rejects even the correct code (R5)', async () => {
    const { approvers, otps, useCase } = buildDeps({ attempts: 2 });
    seedStoredCode(otps, '123456');

    // third wrong code → lockout
    await expect(
      useCase.execute({ ...CMD, code: '000000' })
    ).rejects.toThrow(LockedOutError);

    const gate = approvers.gateState('req-1', 'bob@example.com')!;
    expect(gate.attempts).toBe(3);
    expect(gate.tokenStatus).toBe('INVALIDATED_LOCKOUT');

    // even the CORRECT code is now rejected (gate sees lockout before OTP check)
    await expect(useCase.execute(CMD)).rejects.toThrow(LockedOutError);
    expect(otps.consumeCalls).toBe(0);
  });

  it('does not overshoot the counter: attempts never exceeds lockout limit', async () => {
    const { approvers, otps, useCase } = buildDeps();
    seedStoredCode(otps, '123456'); // a valid OTP so wrong submissions hit the counter
    // 3 wrong submissions → 1,2 then lockout at 3
    for (let i = 0; i < 3; i += 1) {
      await useCase.execute({ ...CMD, code: '000000' }).catch(() => undefined);
    }
    expect(approvers.gateState('req-1', 'bob@example.com')!.attempts).toBe(3);
  });
});

describe('ValidateOtp gate (spec R7)', () => {
  it('blocks validation on a terminal request', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail({ status: 'REJECTED' }));
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const useCase = new ValidateOtp(
      new ApproverGate(requests, approvers),
      approvers,
      new FakeOtpRepository(),
      new OtpService()
    );

    await expect(useCase.execute(CMD)).rejects.toThrow(TerminalRequestError);
  });

  it('rejects an unknown token', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const useCase = new ValidateOtp(
      new ApproverGate(requests, approvers),
      approvers,
      new FakeOtpRepository(),
      new OtpService()
    );

    await expect(
      useCase.execute({ ...CMD, token: 'bogus' })
    ).rejects.toThrow(UnknownTokenError);
  });
});