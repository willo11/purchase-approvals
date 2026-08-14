import {
  PurchaseRequest,
  CreateRequestInput,
} from '../../../src/domain/PurchaseRequest';
import { Approver } from '../../../src/domain/Approver';
import { ApproverStatus } from '../../../src/domain/enums/ApproverStatus';
import {
  EmptyTitleError,
  EmptyDescriptionError,
  InvalidAmountError,
  InvalidApproverCountError,
  DuplicateApproverError,
  RequesterIsApproverError,
  InvalidEmailError,
} from '../../../src/domain/errors';

function validInput(): CreateRequestInput {
  return {
    title: 'New laptop',
    description: 'Work machine',
    amount: 1200.5,
    requesterEmail: 'ana@example.com',
    approverEmails: ['bob@example.com', 'carol@example.com', 'dave@example.com'],
  };
}

describe('PurchaseRequest.validateDraft (R1)', () => {
  it('accepts a valid payload and normalizes emails', () => {
    const draft = PurchaseRequest.validateDraft(validInput());
    expect(draft.title).toBe('New laptop');
    expect(draft.amount.getValue()).toBe(1200.5);
    expect(draft.requesterEmail.toString()).toBe('ana@example.com');
    expect(draft.approverEmails.map((e) => e.toString())).toEqual([
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
    ]);
  });

  it('rejects an empty title', () => {
    expect(() => PurchaseRequest.validateDraft({ ...validInput(), title: '  ' })).toThrow(
      EmptyTitleError
    );
  });

  it('rejects an empty description', () => {
    expect(() =>
      PurchaseRequest.validateDraft({ ...validInput(), description: '' })
    ).toThrow(EmptyDescriptionError);
  });

  it('rejects a bad amount (≤0 or >2 decimals)', () => {
    expect(() => PurchaseRequest.validateDraft({ ...validInput(), amount: 0 })).toThrow(
      InvalidAmountError
    );
    expect(() =>
      PurchaseRequest.validateDraft({ ...validInput(), amount: 9.999 })
    ).toThrow(InvalidAmountError);
  });

  it('rejects the wrong approver count', () => {
    expect(() =>
      PurchaseRequest.validateDraft({
        ...validInput(),
        approverEmails: ['a@x.com', 'b@x.com'],
      })
    ).toThrow(InvalidApproverCountError);
  });

  it('rejects duplicate approver emails', () => {
    expect(() =>
      PurchaseRequest.validateDraft({
        ...validInput(),
        approverEmails: ['bob@example.com', 'bob@example.com', 'carol@example.com'],
      })
    ).toThrow(DuplicateApproverError);
  });

  it('rejects the requester being one of the approvers', () => {
    expect(() =>
      PurchaseRequest.validateDraft({
        ...validInput(),
        requesterEmail: 'bob@example.com',
      })
    ).toThrow(RequesterIsApproverError);
  });

  it('rejects an invalid email anywhere in the payload', () => {
    expect(() =>
      PurchaseRequest.validateDraft({ ...validInput(), requesterEmail: 'not-an-email' })
    ).toThrow(InvalidEmailError);
    expect(() =>
      PurchaseRequest.validateDraft({
        ...validInput(),
        approverEmails: ['a@x.com', 'not-an-email', 'c@x.com'],
      })
    ).toThrow(InvalidEmailError);
  });
});

describe('PurchaseRequest.assemble + toDetail/toSummary', () => {
  it('builds a PENDING request embedding name snapshots', () => {
    const draft = PurchaseRequest.validateDraft(validInput());
    const request = PurchaseRequest.assemble({
      id: 'req-1',
      createdAt: '2026-08-14T00:00:00.000Z',
      draft,
      requesterName: 'Ana',
      approverNames: ['Bob', 'Carol', 'Dave'],
    });

    expect(request.getId()).toBe('req-1');
    expect(request.getStatus()).toBe('PENDING');
    expect(request.toSummary()).toEqual({
      id: 'req-1',
      title: 'New laptop',
      amount: 1200.5,
      currency: 'USD',
      status: 'PENDING',
      createdAt: '2026-08-14T00:00:00.000Z',
    });

    const detail = request.toDetail();
    expect(detail.createdBy).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(detail.approvers).toHaveLength(3);
    expect(detail.approvers.map((a) => a.status)).toEqual([
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    expect(detail.approvers.map((a) => a.name)).toEqual(['Bob', 'Carol', 'Dave']);
  });

  it('rejects misaligned approver names', () => {
    const draft = PurchaseRequest.validateDraft(validInput());
    expect(() =>
      PurchaseRequest.assemble({
        id: 'req-1',
        createdAt: '2026-08-14T00:00:00.000Z',
        draft,
        requesterName: 'Ana',
        approverNames: ['Bob'],
      })
    ).toThrow(InvalidApproverCountError);
  });
});

describe('Approver rehydration (R4 per-approver status)', () => {
  it('derives SIGNED and REJECTED status out of persisted timestamps', () => {
    const signed = Approver.fromSnapshot({
      email: 'bob@example.com',
      name: 'Bob',
      status_signed: '2026-08-14T00:00:01.000Z',
    });
    expect(signed.getStatus()).toBe(ApproverStatus.SIGNED);
    expect(signed.toView()).toEqual({
      email: 'bob@example.com',
      name: 'Bob',
      status: 'SIGNED',
      signedAt: '2026-08-14T00:00:01.000Z',
    });

    const rejected = Approver.fromSnapshot({
      email: 'carol@example.com',
      name: 'Carol',
      status_rejected: '2026-08-14T00:00:02.000Z',
    });
    expect(rejected.getStatus()).toBe(ApproverStatus.REJECTED);
    expect(rejected.toView().rejectedAt).toBe('2026-08-14T00:00:02.000Z');

    const pending = Approver.fromSnapshot({ email: 'dave@example.com', name: 'Dave' });
    expect(pending.getStatus()).toBe(ApproverStatus.PENDING);
    expect(pending.toView().signedAt).toBeUndefined();
    expect(pending.toView().rejectedAt).toBeUndefined();
  });
});