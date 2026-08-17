import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  buildIssueOtp,
  buildValidateOtp,
  buildRegenerateOtp,
  buildRecoverApproverOtp,
} from '../../../src/api/handlers/otp';
import { IssueOtp } from '../../../src/application/IssueOtp';
import { ValidateOtp } from '../../../src/application/ValidateOtp';
import { RegenerateOtp } from '../../../src/application/RegenerateOtp';
import { RecoverApproverOtp } from '../../../src/application/RecoverApproverOtp';
import { ApproverGate } from '../../../src/application/ApproverGate';
import { OtpService } from '../../../src/domain/services/OtpService';
import { Otp } from '../../../src/domain/values/Otp';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeOtpRepository } from '../helpers/fakeOtpRepository';
import { FakeMailPort } from '../helpers/fakeMailPort';
import { otpRequestDetail, activeGate } from '../helpers/otpFixture';

const CONTEXT = 'req-1#bob@example.com';

function postEvent(paths: { requestId: string; token: string }, body?: unknown): APIGatewayProxyEvent {
  return {
    pathParameters: paths,
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEvent;
}

function buildHandlerSuite(approverOverrides: Record<string, unknown> = {}) {
  const requests = new FakeRequestRepository();
  requests.seedDetail(otpRequestDetail());
  const approvers = new FakeApproverRepository().seed('req-1', activeGate(approverOverrides));
  const otps = new FakeOtpRepository();
  const mail = new FakeMailPort();
  const gate = new ApproverGate(requests, approvers);
  const otpService = new OtpService();

  const issue = buildIssueOtp(new IssueOtp(gate, otps, otpService, mail));
  const validate = buildValidateOtp(new ValidateOtp(gate, approvers, otps, otpService));
  const regenerate = buildRegenerateOtp(
    new RegenerateOtp(gate, approvers, otps, otpService, mail)
  );
  return { requests, approvers, otps, mail, issue, validate, regenerate };
}

describe('POST .../otp  (issue)', () => {
  it('returns 201 { expiresInSeconds: 180 }', async () => {
    const { issue } = buildHandlerSuite();
    const res = await issue(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ expiresInSeconds: 180 });
  });

  it('returns 404 for an unknown token', async () => {
    const { issue } = buildHandlerSuite();
    const res = await issue(postEvent({ requestId: 'req-1', token: 'bogus' }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when the approver is locked out', async () => {
    const { issue } = buildHandlerSuite({ tokenStatus: 'INVALIDATED_LOCKOUT', attempts: 3 });
    const res = await issue(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(403);
  });

  it('returns 410 when the request is terminal', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail({ status: 'REJECTED' }));
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const issue = buildIssueOtp(
      new IssueOtp(
        new ApproverGate(requests, approvers),
        new FakeOtpRepository(),
        new OtpService(),
        new FakeMailPort()
      )
    );
    const res = await issue(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(410);
  });
});

describe('POST .../otp — error body contract pinned for the approver classifier', () => {
  // The approver remote (frontend/approver/src/lib/flow.js) keys its terminal
  // screens on the ERROR NAME and the exact English MESSAGE of the 409/410
  // bodies below (e.g. /signed/i vs /rejected/i on 409, COMPLETED vs REJECTED
  // on 410). These strings are produced by ApproverGate (application layer)
  // and mapped verbatim by the handler — the tests below PIN them so a
  // backend rewording fails here first, with both frontend suites still green.

  function issueFor(approverOverrides: Record<string, unknown> = {}, detailOverrides: Record<string, unknown> = {}) {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail(detailOverrides));
    const approvers = new FakeApproverRepository().seed('req-1', activeGate(approverOverrides));
    return buildIssueOtp(
      new IssueOtp(
        new ApproverGate(requests, approvers),
        new FakeOtpRepository(),
        new OtpService(),
        new FakeMailPort()
      )
    );
  }

  it('pins the 409 body for an already-SIGNED approver', async () => {
    const issue = issueFor({ status_signed: '2026-08-14T09:00:00.000Z' });
    const res = await issue(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'AlreadyActedError',
      message: 'This approver already signed the request',
    });
  });

  it('pins the 409 body for an already-REJECTED approver', async () => {
    const issue = issueFor({ status_rejected: '2026-08-14T09:00:00.000Z' });
    const res = await issue(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'AlreadyActedError',
      message: 'This approver already rejected the request',
    });
  });

  it('pins the 410 body for a COMPLETED request', async () => {
    const issue = issueFor({}, { status: 'COMPLETED' });
    const res = await issue(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.body)).toEqual({
      error: 'TerminalRequestError',
      message: 'Request req-1 is already COMPLETED; no OTP flow is offered',
    });
  });

  it('pins the 410 body for a REJECTED request', async () => {
    const issue = issueFor({}, { status: 'REJECTED' });
    const res = await issue(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.body)).toEqual({
      error: 'TerminalRequestError',
      message: 'Request req-1 is already REJECTED; no OTP flow is offered',
    });
  });
});

describe('POST .../otp/validate', () => {
  it('returns 200 { valid: true } on a correct code and consumes the OTP', async () => {
    const { otps, validate } = buildHandlerSuite();
    otps.putOtp('req-1', 'bob@example.com',
      new OtpService().hash(Otp.create('123456'), CONTEXT),
      Math.floor(Date.now() / 1000) + 180);

    const res = await validate(
      postEvent({ requestId: 'req-1', token: 'token-bob' }, { code: '123456' })
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ valid: true });
    expect(otps.stored('req-1', 'bob@example.com')).toBeUndefined();
  });

  it('returns 401 with { attemptsRemaining } on a wrong code', async () => {
    const { otps, validate } = buildHandlerSuite();
    otps.putOtp('req-1', 'bob@example.com',
      new OtpService().hash(Otp.create('123456'), CONTEXT),
      Math.floor(Date.now() / 1000) + 180);

    const res = await validate(
      postEvent({ requestId: 'req-1', token: 'token-bob' }, { code: '000000' })
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({ attemptsRemaining: 2 })
    );
  });

  it('returns 403 (lockout) on the 3rd failure', async () => {
    const { otps, validate } = buildHandlerSuite({ attempts: 2 });
    otps.putOtp('req-1', 'bob@example.com',
      new OtpService().hash(Otp.create('123456'), CONTEXT),
      Math.floor(Date.now() / 1000) + 180);

    const res = await validate(
      postEvent({ requestId: 'req-1', token: 'token-bob' }, { code: '000000' })
    );
    expect(res.statusCode).toBe(403);
  });

  it('returns 410 for an expired OTP and 400 for a malformed code', async () => {
    const { otps, validate } = buildHandlerSuite();
    otps.putOtp('req-1', 'bob@example.com',
      new OtpService().hash(Otp.create('123456'), CONTEXT),
      Math.floor(Date.now() / 1000) - 60);

    const expired = await validate(
      postEvent({ requestId: 'req-1', token: 'token-bob' }, { code: '123456' })
    );
    expect(expired.statusCode).toBe(410);

    otps.putOtp('req-1', 'bob@example.com',
      new OtpService().hash(Otp.create('123456'), CONTEXT),
      Math.floor(Date.now() / 1000) + 180);
    const malformed = await validate(
      postEvent({ requestId: 'req-1', token: 'token-bob' }, { code: '12ab' })
    );
    expect(malformed.statusCode).toBe(400);
  });
});

describe('POST .../otp/regenerate', () => {
  it('returns 201 { expiresInSeconds: 180 }', async () => {
    const { regenerate } = buildHandlerSuite({ attempts: 1 });
    const res = await regenerate(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ expiresInSeconds: 180 });
  });

  it('returns 403 when the approver token is NOT active (lockout)', async () => {
    const { regenerate } = buildHandlerSuite({ tokenStatus: 'INVALIDATED_LOCKOUT', attempts: 3 });
    const res = await regenerate(postEvent({ requestId: 'req-1', token: 'token-bob' }));
    expect(res.statusCode).toBe(403);
  });
});

describe('POST .../approvers/:email/recover (requester-initiated recovery)', () => {
  function recoverEvent(email = 'bob@example.com'): APIGatewayProxyEvent {
    return {
      pathParameters: { id: 'req-1', email },
    } as unknown as APIGatewayProxyEvent;
  }

  function buildRecover(approverOverrides: Record<string, unknown> = {}, detailOverrides: Record<string, unknown> = {}) {
    const requests = new FakeRequestRepository().seedDetail(otpRequestDetail(detailOverrides));
    const approvers = new FakeApproverRepository().seed('req-1', activeGate(approverOverrides));
    const otps = new FakeOtpRepository();
    const mail = new FakeMailPort();
    const recover = buildRecoverApproverOtp(
      new RecoverApproverOtp(requests, approvers, otps, new OtpService(), mail)
    );
    return { requests, approvers, otps, mail, recover };
  }

  it('returns 201 { expiresInSeconds: 180 } for a LOCKED approver and resets attempts', async () => {
    const { approvers, otps, mail, recover } = buildRecover({
      tokenStatus: 'INVALIDATED_LOCKOUT',
      attempts: 3,
    });

    const res = await recover(recoverEvent());
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ expiresInSeconds: 180 });

    // locked approver recovered: ACTIVE + attempts reset; fresh OTP + mail sent
    expect(approvers.gateState('req-1', 'bob@example.com')!.tokenStatus).toBe('ACTIVE');
    expect(approvers.gateState('req-1', 'bob@example.com')!.attempts).toBe(0);
    expect(otps.putCalls).toBe(1);
    expect(mail.sendCalls).toBe(1);
  });

  it('returns 409 for a NON-locked (innocent pending) approver — no OTP, no mail', async () => {
    const { otps, mail, recover } = buildRecover({ tokenStatus: 'ACTIVE', attempts: 1 });

    const res = await recover(recoverEvent());
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('ApproverNotLockedError');
    expect(otps.putCalls).toBe(0);
    expect(mail.sendCalls).toBe(0);
  });

  it('returns 404 for an unknown request', async () => {
    const { recover } = buildRecover();
    const res = await recover({
      pathParameters: { id: 'missing', email: 'bob@example.com' },
    } as unknown as APIGatewayProxyEvent);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the email is not an approver of the request', async () => {
    const { recover } = buildRecover();
    const res = await recover(recoverEvent('nobody@example.com'));
    expect(res.statusCode).toBe(404);
  });

  it('returns 410 when the request is terminal (COMPLETED)', async () => {
    const { recover } = buildRecover({ tokenStatus: 'INVALIDATED_LOCKOUT', attempts: 3 }, { status: 'COMPLETED' });
    const res = await recover(recoverEvent());
    expect(res.statusCode).toBe(410);
  });
});