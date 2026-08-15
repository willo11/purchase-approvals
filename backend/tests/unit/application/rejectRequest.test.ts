import type { RequestDetail } from '../../../src/domain/PurchaseRequest';
import { RejectRequest } from '../../../src/application/RejectRequest';
import { ApproverGate } from '../../../src/application/ApproverGate';
import { TerminalRequestError } from '../../../src/domain/errors';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';

const SIGNED_COND =
  'attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)';
const REJECT_COND = 'status = :pending AND attribute_not_exists(rejectedAt)';

function pendingDetail(): RequestDetail {
  const pending = { status: 'PENDING' as const };
  return {
    id: 'req-1',
    title: 'New laptop',
    description: 'Work machine',
    amount: 1200.5,
    currency: 'USD',
    status: 'PENDING',
    createdBy: { email: 'ana@example.com', name: 'Ana' },
    approvers: [
      { email: 'bob@example.com', name: 'Bob', ...pending },
      { email: 'carol@example.com', name: 'Carol', ...pending },
      { email: 'dave@example.com', name: 'Dave', ...pending },
    ],
    createdAt: '2026-08-14T00:00:00.000Z',
  };
}

function seedApprovers(approvers: FakeApproverRepository): void {
  const gate = { tokenStatus: 'ACTIVE' as const, attempts: 0 };
  approvers.seed('req-1', {
    email: 'bob@example.com', name: 'Bob', token: 'token-bob', ...gate,
    validatedAt: '2026-08-14T08:30:00.000Z',
  });
  approvers.seed('req-1', {
    email: 'carol@example.com', name: 'Carol', token: 'token-carol', ...gate,
    validatedAt: '2026-08-14T08:30:00.000Z',
  });
  approvers.seed('req-1', {
    email: 'dave@example.com', name: 'Dave', token: 'token-dave', ...gate,
    validatedAt: '2026-08-14T08:30:00.000Z',
  });
}

function build() {
  const requests = new FakeRequestRepository().seedDetail(pendingDetail());
  const approvers = new FakeApproverRepository();
  seedApprovers(approvers);
  requests.useApproverSource(approvers);
  const reject = new RejectRequest(new ApproverGate(requests, approvers), approvers, requests);
  return { requests, approvers, reject, gate: new ApproverGate(requests, approvers) };
}

describe('RejectRequest (spec R2)', () => {
  it('records a rejection and sets the request globally REJECTED immediately', async () => {
    const { reject, approvers, requests } = build();
    const result = await reject.execute({ requestId: 'req-1', token: 'token-bob' });

    // Step A: rejected with the registered name + exact approver-CAS condition
    expect(approvers.lastSignature).toEqual({ name: 'Bob', timestamp: expect.any(String) });
    expect(approvers.lastRejectedCondition).toBe(SIGNED_COND);
    // Step B: REQ CAS with the exact reject condition
    expect(requests.rejectCalls).toBe(1);
    expect(requests.lastRejectCondition).toBe(REJECT_COND);
    expect(result.status).toBe('REJECTED');
    expect(result.approvers.find((a) => a.email === 'bob@example.com')?.status).toBe('REJECTED');
  });

  it('a second reject cannot happen: global REJECTED dominates (R2 > R4)', async () => {
    const { reject } = build();
    await reject.execute({ requestId: 'req-1', token: 'token-bob' });
    // The FIRST reject set the request globally REJECTED, so the second action
    // hits the terminal gate (410) before any per-approver already-acted logic.
    await expect(
      reject.execute({ requestId: 'req-1', token: 'token-bob' })
    ).rejects.toThrow(TerminalRequestError);
  });

  it('after a rejection every other approver link is blocked as terminal (R2)', async () => {
    const { reject, gate } = build();
    await reject.execute({ requestId: 'req-1', token: 'token-bob' });

    // carol's link resolves against a now-REJECTED request → terminal (410)
    await expect(gate.resolve('req-1', 'token-carol')).rejects.toThrow(TerminalRequestError);
    await expect(gate.resolve('req-1', 'token-dave')).rejects.toThrow(TerminalRequestError);
  });
});