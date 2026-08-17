import type { RequestDetail } from '../../../src/domain/PurchaseRequest';
import { ApproveRequest } from '../../../src/application/ApproveRequest';
import { ApproverGate } from '../../../src/application/ApproverGate';
import { AlreadyActedError } from '../../../src/domain/errors';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeEvidenceGenerator } from '../helpers/fakeEvidenceGenerator';
import { FakeEvidenceStore } from '../helpers/fakeEvidenceStore';

const SIGNED_COND =
  'attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)';
const COMPLETION_COND = 'attribute_not_exists(completedAt) AND status = :pending';

/**
 * Seeds a PENDING request owned by ana whose approvers match bob/carol/dave.
 * `signed` lists emails already shown as `SIGNED`.
 */
function approvalDetail(signed: string[] = []): RequestDetail {
  const make = (email: string, name: string) => ({
    email,
    name,
    status: (signed.includes(email) ? 'SIGNED' : 'PENDING') as RequestDetail['approvers'][number]['status'],
    locked: false,
    signedAt: signed.includes(email) ? '2026-08-14T09:00:00.000Z' : undefined,
  });
  return {
    id: 'req-1',
    title: 'New laptop',
    description: 'Work machine',
    amount: 1200.5,
    currency: 'USD',
    status: 'PENDING',
    createdBy: { email: 'ana@example.com', name: 'Ana' },
    approvers: [make('bob@example.com', 'Bob'), make('carol@example.com', 'Carol'), make('dave@example.com', 'Dave')],
    createdAt: '2026-08-14T00:00:00.000Z',
  };
}

/** Gate states for the three approvers; `preSigned` become status_signed. */
function seedApprovers(approvers: FakeApproverRepository, preSigned: string[] = []): void {
  const gate = { tokenStatus: 'ACTIVE' as const, attempts: 0 };
  const rows = [
    { email: 'bob@example.com', name: 'Bob', token: 'token-bob' },
    { email: 'carol@example.com', name: 'Carol', token: 'token-carol' },
    { email: 'dave@example.com', name: 'Dave', token: 'token-dave' },
  ];
  for (const row of rows) {
    approvers.seed('req-1', {
      ...row,
      ...gate,
      // every approver validated an OTP before acting (spec R1/R2 precondition)
      validatedAt: '2026-08-14T08:30:00.000Z',
      status_signed: preSigned.includes(row.email) ? '2026-08-14T09:00:00.000Z' : undefined,
    });
  }
}

function build() {
  const requests = new FakeRequestRepository().seedDetail(approvalDetail());
  const approvers = new FakeApproverRepository();
  seedApprovers(approvers);
  requests.useApproverSource(approvers);
  const evidence = new FakeEvidenceGenerator();
  const evidenceStore = new FakeEvidenceStore();
  const approve = new ApproveRequest(
    new ApproverGate(requests, approvers),
    approvers,
    requests,
    evidence,
    evidenceStore
  );
  return { requests, approvers, evidence, evidenceStore, approve };
}

describe('ApproveRequest (spec R1, R4 — Step A)', () => {
  it('records a signature using the registered snapshot name, never a typed name (R1)', async () => {
    const { approve, approvers } = build();
    const result = await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    expect(approvers.lastSignature).toEqual({
      name: 'Bob', // registered snapshot — not supplied by the caller
      timestamp: expect.any(String),
    });
    // Step A emitted the exact approver-CAS condition (design-concurrency §3).
    expect(approvers.lastSignedCondition).toBe(SIGNED_COND);
    // the returned detail now shows bob as SIGNED with the recorded timestamp
    const bob = result.approvers.find((a) => a.email === 'bob@example.com');
    expect(bob?.status).toBe('SIGNED');
    expect(bob?.signedAt).toBe(approvers.lastSignature?.timestamp);
  });

  it('an approver who already signed cannot sign twice (R4)', async () => {
    const { approve } = build();
    await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    await expect(
      approve.execute({ requestId: 'req-1', token: 'token-bob' })
    ).rejects.toThrow(AlreadyActedError);
  });

  it('an approver who already rejected cannot then approve (R4 directionality)', async () => {
    const requests = new FakeRequestRepository().seedDetail(approvalDetail());
    const approvers = new FakeApproverRepository();
    seedApprovers(approvers);
    // bob already acted — but as a REJECTION, not a signature
    approvers.seed('req-1', {
      email: 'bob@example.com',
      name: 'Bob',
      token: 'token-bob',
      tokenStatus: 'ACTIVE',
      attempts: 0,
      validatedAt: '2026-08-14T08:30:00.000Z',
      status_rejected: '2026-08-14T09:00:00.000Z',
    });
    requests.useApproverSource(approvers);
    const approve = new ApproveRequest(
      new ApproverGate(requests, approvers),
      approvers,
      requests,
      new FakeEvidenceGenerator(),
      new FakeEvidenceStore()
    );

    // approve-after-reject is blocked by the gate (already acted → 409)
    await expect(
      approve.execute({ requestId: 'req-1', token: 'token-bob' })
    ).rejects.toThrow(AlreadyActedError);
    expect(approvers.markSignedCalls).toBe(0); // Step A never committed a signature
  });
});

describe('ApproveRequest completion (spec R3/R4 — Step B)', () => {
  it('the 3rd signature issues the completion CAS and generates evidence exactly once (R3)', async () => {
    const requests = new FakeRequestRepository().seedDetail(approvalDetail(['carol@example.com', 'dave@example.com']));
    const approvers = new FakeApproverRepository();
    seedApprovers(approvers, ['carol@example.com', 'dave@example.com']);
    requests.useApproverSource(approvers);
    const evidence = new FakeEvidenceGenerator();
    const evidenceStore = new FakeEvidenceStore();
    const approve = new ApproveRequest(
      new ApproverGate(requests, approvers),
      approvers,
      requests,
      evidence,
      evidenceStore
    );

    const result = await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    // the completion CAS was issued with the exact condition + single winner
    expect(requests.completeCalls).toBe(1);
    expect(requests.lastCompleteCondition).toBe(COMPLETION_COND);
    expect(result.status).toBe('COMPLETED');
    // only the CAS winner generates evidence
    expect(evidence.calls).toBe(1);
    // both signatures recorded: bob now plus the two pre-signed approvers
    const signedEmails = result.approvers.filter((a) => a.status === 'SIGNED').map((a) => a.email);
    expect(signedEmails.sort()).toEqual([
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
    ]);
  });

  it('a pending approver who is NOT the 3rd signature does not issue the completion CAS', async () => {
    const requests = new FakeRequestRepository().seedDetail(approvalDetail(['carol@example.com']));
    const approvers = new FakeApproverRepository();
    seedApprovers(approvers, ['carol@example.com']);
    requests.useApproverSource(approvers);
    const evidence = new FakeEvidenceGenerator();
    const evidenceStore = new FakeEvidenceStore();
    const approve = new ApproveRequest(
      new ApproverGate(requests, approvers),
      approvers,
      requests,
      evidence,
      evidenceStore
    );

    await approve.execute({ requestId: 'req-1', token: 'token-dave' });

    expect(requests.completeCalls).toBe(0); // only 2 signed → no completion CAS
    expect(evidence.calls).toBe(0);
  });

  it('when the completion CAS loses, the loser does NOT generate evidence and returns the rival COMPLETED state (R3/R4)', async () => {
    const requests = new FakeRequestRepository().seedDetail(approvalDetail(['carol@example.com', 'dave@example.com']));
    requests.simulateAlreadyCompleted = true; // a concurrent writer already completed it
    const approvers = new FakeApproverRepository();
    seedApprovers(approvers, ['carol@example.com', 'dave@example.com']);
    requests.useApproverSource(approvers);
    const evidence = new FakeEvidenceGenerator();
    const evidenceStore = new FakeEvidenceStore();
    const approve = new ApproveRequest(
      new ApproverGate(requests, approvers),
      approvers,
      requests,
      evidence,
      evidenceStore
    );

    const result = await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    expect(requests.completeCalls).toBe(1);
    expect(evidence.calls).toBe(0); // LOSSER MUST NOT generate (spec R4)
    // the loser returns the RIVAL's committed state — a COMPLETED request
    // (real contract: re-read after ConditionalCheckFailed sees completedAt)
    expect(result.status).toBe('COMPLETED');
  });
});