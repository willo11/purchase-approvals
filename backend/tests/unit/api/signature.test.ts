import type { APIGatewayProxyEvent } from 'aws-lambda';
import { buildApprove, buildReject } from '../../../src/api/handlers/signature';
import { ApproveRequest } from '../../../src/application/ApproveRequest';
import { RejectRequest } from '../../../src/application/RejectRequest';
import { ApproverGate } from '../../../src/application/ApproverGate';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeEvidenceGenerator } from '../helpers/fakeEvidenceGenerator';
import { FakeEvidenceStore } from '../helpers/fakeEvidenceStore';
import { otpRequestDetail, activeGate } from '../helpers/otpFixture';

function postEvent(
  token: string,
  body?: unknown
): APIGatewayProxyEvent {
  return {
    pathParameters: { requestId: 'req-1', token },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEvent;
}

function buildHandlers(approverOverrides: Record<string, unknown> = {}) {
  const requests = new FakeRequestRepository().seedDetail(otpRequestDetail());
  // every approver validated an OTP first (spec R1/R2 precondition); tests may
  // override to model a non-validated approver (→ 401)
  const approvers = new FakeApproverRepository().seed(
    'req-1',
    activeGate({ validatedAt: '2026-08-14T08:30:00.000Z', ...approverOverrides })
  );
  requests.useApproverSource(approvers);
  const evidence = new FakeEvidenceGenerator();
  const gate = new ApproverGate(requests, approvers);
  const approve = buildApprove(
    new ApproveRequest(gate, approvers, requests, evidence, new FakeEvidenceStore())
  );
  const reject = buildReject(new RejectRequest(gate, approvers, requests));
  return { requests, approvers, approve, reject };
}

describe('POST .../{token}/approve (#10)', () => {
  it('returns 201 with the request detail', async () => {
    const { approve } = buildHandlers();
    const res = await approve(postEvent('token-bob'));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string };
    expect(body.id).toBe('req-1');
  });

  it('returns 404 for an unknown token', async () => {
    const { approve } = buildHandlers();
    const res = await approve(postEvent('bogus'));
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when the approver is locked out', async () => {
    const { approve } = buildHandlers({ tokenStatus: 'INVALIDATED_LOCKOUT', attempts: 3 });
    const res = await approve(postEvent('token-bob'));
    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when the approver never validated an OTP', async () => {
    // validatedAt missing → the validated-OTP precondition fails (spec R1/R2)
    const { approve, reject } = buildHandlers({ validatedAt: undefined });
    const res = await approve(postEvent('token-bob'));
    expect(res.statusCode).toBe(401);
    const res2 = await reject(postEvent('token-bob', { confirm: true }));
    expect(res2.statusCode).toBe(401);
  });

  it('returns 409 when the approver already acted', async () => {
    const { approve } = buildHandlers({ status_signed: '2026-08-14T09:00:00.000Z' });
    const res = await approve(postEvent('token-bob'));
    expect(res.statusCode).toBe(409);
  });

  it('returns 410 when the request is terminal', async () => {
    const requests = new FakeRequestRepository().seedDetail(
      otpRequestDetail({ status: 'REJECTED' })
    );
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const evidence = new FakeEvidenceGenerator();
    const approve = buildApprove(
      new ApproveRequest(
        new ApproverGate(requests, approvers),
        approvers,
        requests,
        evidence,
        new FakeEvidenceStore()
      )
    );
    const res = await approve(postEvent('token-bob'));
    expect(res.statusCode).toBe(410);
  });
});

describe('POST .../{token}/reject (#11)', () => {
  it('returns 201 with the request detail when { confirm: true }', async () => {
    const { reject } = buildHandlers();
    const res = await reject(postEvent('token-bob', { confirm: true }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).status).toBe('REJECTED');
  });

  it('returns 400 when confirm is not true', async () => {
    const { reject } = buildHandlers();
    const missing = await reject(postEvent('token-bob'));
    expect(missing.statusCode).toBe(400);
    const falseConfirm = await reject(postEvent('token-bob', { confirm: false }));
    expect(falseConfirm.statusCode).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    const { reject } = buildHandlers();
    const res = await reject(postEvent('bogus', { confirm: true }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when the approver already acted', async () => {
    const { reject } = buildHandlers({ status_rejected: '2026-08-14T09:00:00.000Z' });
    const res = await reject(postEvent('token-bob', { confirm: true }));
    expect(res.statusCode).toBe(409);
  });

  it('returns 410 when the request is terminal', async () => {
    const requests = new FakeRequestRepository().seedDetail(
      otpRequestDetail({ status: 'COMPLETED' })
    );
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const reject = buildReject(
      new RejectRequest(new ApproverGate(requests, approvers), approvers, requests)
    );
    const res = await reject(postEvent('token-bob', { confirm: true }));
    expect(res.statusCode).toBe(410);
  });
});