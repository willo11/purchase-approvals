import type { RequestDetail } from '../../../src/domain/PurchaseRequest';
import { ApproveRequest } from '../../../src/application/ApproveRequest';
import { ApproverGate } from '../../../src/application/ApproverGate';
import type { EvidenceGeneratorPort } from '../../../src/application/ports/EvidenceGeneratorPort';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { FakeEvidenceGenerator } from '../helpers/fakeEvidenceGenerator';
import { FakeEvidenceStore } from '../helpers/fakeEvidenceStore';

/** Exact evidence idempotency condition asserted on the fake repo (design-concurrency §5). */
const EVIDENCE_COND = 'attribute_not_exists(evidenceKey)';

/** Generator that always fails — simulates a pdf-lib crash (spec R4). */
class FailingGenerator implements EvidenceGeneratorPort {
  async generate(): Promise<Uint8Array> {
    throw new Error('pdf-lib exploded');
  }
}

/** Seeded detail mirroring approveRequest.test.ts: ana owns req-1, bob/carol/dave approve. */
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

function seedApprovers(approvers: FakeApproverRepository, preSigned: string[] = []): void {
  const rows = [
    { email: 'bob@example.com', name: 'Bob', token: 'token-bob' },
    { email: 'carol@example.com', name: 'Carol', token: 'token-carol' },
    { email: 'dave@example.com', name: 'Dave', token: 'token-dave' },
  ];
  for (const row of rows) {
    approvers.seed('req-1', {
      ...row,
      tokenStatus: 'ACTIVE',
      attempts: 0,
      validatedAt: '2026-08-14T08:30:00.000Z',
      status_signed: preSigned.includes(row.email) ? '2026-08-14T09:00:00.000Z' : undefined,
    });
  }
}

function build(detail: RequestDetail, preSigned: string[]) {
  const requests = new FakeRequestRepository().seedDetail(detail);
  const approvers = new FakeApproverRepository();
  seedApprovers(approvers, preSigned);
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

describe('ApproveRequest evidence wiring (task 5.3, design-concurrency §5)', () => {
  it('the completion CAS winner stores the PDF under the deterministic key and records evidenceKey idempotently', async () => {
    const { requests, evidence, evidenceStore, approve } = build(
      approvalDetail(['carol@example.com', 'dave@example.com']),
      ['carol@example.com', 'dave@example.com']
    );

    const result = await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    // generate → store.put under reqs/<id>/evidence.pdf → recordEvidence
    expect(evidence.calls).toBe(1);
    expect(evidenceStore.putCalls).toHaveLength(1);
    expect(evidenceStore.putCalls[0].key).toBe('reqs/req-1/evidence.pdf');
    expect(requests.evidenceCalls).toBe(1);
    // the conditional `attribute_not_exists(evidenceKey)` was emitted (R2/R4
    // idempotency — a replay never double-sets)
    expect(requests.lastEvidenceCondition).toBe(EVIDENCE_COND);
    // the detail now carries the recorded key
    expect(result.status).toBe('COMPLETED');
    expect(result.evidenceKey).toBe('reqs/req-1/evidence.pdf');
  });

  it('a generation failure keeps COMPLETED, records no evidenceKey and leaves download 404 (R4)', async () => {
    const requests = new FakeRequestRepository().seedDetail(
      approvalDetail(['carol@example.com', 'dave@example.com'])
    );
    const approvers = new FakeApproverRepository();
    seedApprovers(approvers, ['carol@example.com', 'dave@example.com']);
    requests.useApproverSource(approvers);
    const evidenceStore = new FakeEvidenceStore();
    const approve = new ApproveRequest(
      new ApproverGate(requests, approvers),
      approvers,
      requests,
      new FailingGenerator(),
      evidenceStore
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    expect(result.status).toBe('COMPLETED'); // status kept (R4)
    expect(result.evidenceKey).toBeUndefined(); // nothing recorded
    expect(evidenceStore.putCalls).toHaveLength(0); // upload never attempted
    expect(requests.evidenceCalls).toBe(0);
    expect(errorSpy).toHaveBeenCalled(); // failure logged
    errorSpy.mockRestore();
  });

  it('an upload failure keeps COMPLETED and records no evidenceKey (R4)', async () => {
    const { requests, evidence, evidenceStore, approve } = build(
      approvalDetail(['carol@example.com', 'dave@example.com']),
      ['carol@example.com', 'dave@example.com']
    );
    evidenceStore.failNextPut = true; // S3 PutObject throws
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    expect(evidence.calls).toBe(1); // generation itself succeeded
    expect(result.status).toBe('COMPLETED'); // status kept (R4)
    expect(result.evidenceKey).toBeUndefined();
    expect(requests.evidenceCalls).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a replay that already recorded evidence skips generation entirely (idempotency guard)', async () => {
    // Detail already carries evidenceKey (a prior winner recorded it): the
    // pre-CAS `evidenceKey` read must short-circuit before any generate/put.
    const { requests, evidence, evidenceStore, approve } = build(
      { ...approvalDetail(), evidenceKey: 'reqs/req-1/evidence.pdf' },
      []
    );

    await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    expect(requests.completeCalls).toBe(0); // no completion CAS re-issued
    expect(evidence.calls).toBe(0);
    expect(evidenceStore.putCalls).toHaveLength(0);
  });

  it('the completion CAS loser never touches the evidence store', async () => {
    const { requests, evidence, evidenceStore, approve } = build(
      approvalDetail(['carol@example.com', 'dave@example.com']),
      ['carol@example.com', 'dave@example.com']
    );
    requests.simulateAlreadyCompleted = true; // a concurrent writer won the CAS

    const result = await approve.execute({ requestId: 'req-1', token: 'token-bob' });

    expect(result.status).toBe('COMPLETED');
    expect(evidence.calls).toBe(0); // LOSSER MUST NOT generate (R3/R4)
    expect(evidenceStore.putCalls).toHaveLength(0);
    expect(requests.evidenceCalls).toBe(0);
  });
});
