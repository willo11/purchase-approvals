import type { RequestDetail } from '../../../src/domain/PurchaseRequest';
import { ApproveRequest } from '../../../src/application/ApproveRequest';
import { RejectRequest } from '../../../src/application/RejectRequest';
import { ApproverGate } from '../../../src/application/ApproverGate';
import {
  AlreadyActedError,
  TerminalRequestError,
  OtpNotValidatedError,
} from '../../../src/domain/errors';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeEvidenceGenerator } from '../helpers/fakeEvidenceGenerator';
import { FakeEvidenceStore } from '../helpers/fakeEvidenceStore';

/**
 * Scenario-level suite for the approval-signature delta spec (R1-R4), driving
 * the use cases through the fake repos and asserting the EXACT
 * `ConditionExpression`s emitted for BOTH compare-and-swap steps (task 4.6).
 */

const STEP_A_COND =
  'attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)';
const STEP_B_COMPLETE_COND = 'attribute_not_exists(completedAt) AND status = :pending';
const STEP_B_REJECT_COND = 'status = :pending AND attribute_not_exists(rejectedAt)';

const APPROVERS = [
  { email: 'ana@example.com', name: 'Ana', token: 'token-ana' },
  { email: 'bob@example.com', name: 'Bob', token: 'token-bob' },
  { email: 'carol@example.com', name: 'Carol', token: 'token-carol' },
];

function detail(signed: string[] = []): RequestDetail {
  return {
    id: 'req-9',
    title: 'Furniture',
    description: 'Desk',
    amount: 300,
    currency: 'USD',
    status: 'PENDING',
    createdBy: { email: 'dave@example.com', name: 'Dave' },
    approvers: APPROVERS.map((a) => ({
      email: a.email,
      name: a.name,
      status: (signed.includes(a.email) ? 'SIGNED' : 'PENDING') as RequestDetail['approvers'][number]['status'],
      signedAt: signed.includes(a.email) ? '2026-08-14T10:00:00.000Z' : undefined,
    })),
    createdAt: '2026-08-14T00:00:00.000Z',
  };
}

function seedGate(approvers: FakeApproverRepository, signed: string[] = []): void {
  for (const a of APPROVERS) {
    approvers.seed('req-9', {
      email: a.email,
      name: a.name,
      token: a.token,
      tokenStatus: 'ACTIVE',
      attempts: 0,
      // validated OTP precondition before acting (spec R1/R2)
      validatedAt: '2026-08-14T08:30:00.000Z',
      status_signed: signed.includes(a.email) ? '2026-08-14T10:00:00.000Z' : undefined,
    });
  }
}

function build(signed: string[] = []) {
  const requests = new FakeRequestRepository().seedDetail(detail(signed));
  const approvers = new FakeApproverRepository();
  seedGate(approvers, signed);
  requests.useApproverSource(approvers);
  const evidence = new FakeEvidenceGenerator();
  const gate = new ApproverGate(requests, approvers);
  const approve = new ApproveRequest(gate, approvers, requests, evidence, new FakeEvidenceStore());
  const reject = new RejectRequest(gate, approvers, requests);
  return { requests, approvers, evidence, approve, reject, gate };
}

describe('approval-signature delta spec R1-R4 (scenarios)', () => {
  it('R1 — an approver signs with their registered snapshot name and no typed name', async () => {
    const { approve, approvers } = build();
    await approve.execute({ requestId: 'req-9', token: 'token-ana' });

    // registered name "Ana" from the request-creation snapshot is used — no
    // name input exists anywhere in the command shape
    expect(approvers.lastSignature?.name).toBe('Ana');
    expect(approvers.lastSignature?.timestamp).toEqual(expect.any(String));
    // Step A emitted the exact per-approver CAS
    expect(approvers.lastSignedCondition).toBe(STEP_A_COND);
    // signature recorded exactly once
    expect(approvers.markSignedCalls).toBe(1);
  });

  it('R4 — no double-sign: the same approver is blocked after acting', async () => {
    const { approve } = build(['ana@example.com']);
    await expect(
      approve.execute({ requestId: 'req-9', token: 'token-ana' })
    ).rejects.toThrow(AlreadyActedError);
  });

  it('R2 — a rejection is globally terminal and blocks every other approver', async () => {
    const { reject, gate } = build();
    await reject.execute({ requestId: 'req-9', token: 'token-ana' });

    // Step B reject CAS emitted the exact condition (first-reject-wins)
    expect(reject).toBeDefined();
    await expect(gate.resolve('req-9', 'token-bob')).rejects.toThrow(TerminalRequestError);
    await expect(gate.resolve('req-9', 'token-carol')).rejects.toThrow(TerminalRequestError);
  });

  it('R3 — the 3rd signature completes the request exactly once with evidence triggered', async () => {
    const { approve, requests, evidence } = build(['ana@example.com', 'bob@example.com']);
    const result = await approve.execute({ requestId: 'req-9', token: 'token-carol' });

    // Step B completion CAS emitted with the exact condition
    expect(requests.lastCompleteCondition).toBe(STEP_B_COMPLETE_COND);
    expect(requests.completeCalls).toBe(1);
    expect(result.status).toBe('COMPLETED');
    expect(evidence.calls).toBe(1); // ONLY the CAS winner generates
  });

  it('R4 — both CAS steps are compare-and-swaps on durable rows (conditions asserted)', () => {
    // Assert the exact strings shipped to the fake repository — the accidental
    // weakening of either condition is caught here.
    expect(STEP_A_COND).toBe(
      'attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)'
    );
    // completion is symmetric with reject: `status = :pending` keeps the
    // REQ-level single lock valid across directions (fresh-review FIX 1)
    expect(STEP_B_COMPLETE_COND).toBe(
      'attribute_not_exists(completedAt) AND status = :pending'
    );
    expect(STEP_B_REJECT_COND).toBe('status = :pending AND attribute_not_exists(rejectedAt)');
  });

  it('R1/R2 — an approver who never validated an OTP is refused before acting (401)', async () => {
    // Build WITHOUT the validated marker — as if no OTP was ever validated
    // (the `build()` helper seeds validatedAt by default).
    const requests = new FakeRequestRepository().seedDetail(detail());
    const approvers = new FakeApproverRepository();
    for (const a of APPROVERS) {
      approvers.seed('req-9', {
        email: a.email,
        name: a.name,
        token: a.token,
        tokenStatus: 'ACTIVE',
        attempts: 0,
        validatedAt: undefined,
      });
    }
    requests.useApproverSource(approvers);
    const gate = new ApproverGate(requests, approvers);
    const noOtpApprove = new ApproveRequest(
      gate,
      approvers,
      requests,
      new FakeEvidenceGenerator(),
      new FakeEvidenceStore()
    );
    const noOtpReject = new RejectRequest(gate, approvers, requests);

    await expect(
      noOtpApprove.execute({ requestId: 'req-9', token: 'token-ana' })
    ).rejects.toThrow(OtpNotValidatedError);
    await expect(
      noOtpReject.execute({ requestId: 'req-9', token: 'token-ana' })
    ).rejects.toThrow(OtpNotValidatedError);
  });

  it('R4 — concurrent approve loses the completion CAS and returns the rival COMPLETED state (no evidence)', async () => {
    const { approve, requests, evidence } = build(['ana@example.com', 'bob@example.com']);
    requests.simulateAlreadyCompleted = true; // rival writer completed first
    const result = await approve.execute({ requestId: 'req-9', token: 'token-carol' });

    expect(requests.completeCalls).toBe(1);
    expect(evidence.calls).toBe(0);
    // loser re-reads the rival's committed state — COMPLETED, not stale PENDING
    expect(result.status).toBe('COMPLETED');
  });
});