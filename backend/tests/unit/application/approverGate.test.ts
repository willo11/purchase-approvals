import { ApproverGate } from '../../../src/application/ApproverGate';
import {
  TerminalRequestError,
  LockedOutError,
  UnknownTokenError,
  UnknownRequestError,
  AlreadyActedError,
} from '../../../src/domain/errors';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { FakeApproverRepository } from '../helpers/fakeApproverRepository';
import { otpRequestDetail, activeGate } from '../helpers/otpFixture';

/**
 * Explicit gate-precedence unit tests (spec R7): the chain is checked in fixed
 * order — terminal global state → approver lockout → token resolution — so a
 * terminal request dominates even a locked or unknown approver.
 */
describe('ApproverGate precedence (spec R7, design-concurrency §2)', () => {
  it('terminal global state wins even when the approver is locked out', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail({ status: 'COMPLETED' }));
    const approvers = new FakeApproverRepository().seed(
      'req-1',
      activeGate({ tokenStatus: 'INVALIDATED_LOCKOUT', attempts: 3 })
    );
    const gate = new ApproverGate(requests, approvers);

    await expect(gate.resolve('req-1', 'token-bob')).rejects.toThrow(TerminalRequestError);
  });

  it('terminal state wins even when the token is unknown', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail({ status: 'REJECTED' }));
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const gate = new ApproverGate(requests, approvers);

    await expect(gate.resolve('req-1', 'bogus')).rejects.toThrow(TerminalRequestError);
  });

  it('lockout wins before token semantics on a non-terminal request', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository().seed(
      'req-1',
      activeGate({ tokenStatus: 'INVALIDATED_LOCKOUT', attempts: 3 })
    );
    const gate = new ApproverGate(requests, approvers);

    await expect(gate.resolve('req-1', 'token-bob')).rejects.toThrow(LockedOutError);
  });

  it('unknown token → 404 on a non-terminal request with an ACTIVE approver set', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const gate = new ApproverGate(requests, approvers);

    await expect(gate.resolve('req-1', 'nobody')).rejects.toThrow(UnknownTokenError);
  });

  it('unknown request → 404 before any approver read', async () => {
    const requests = new FakeRequestRepository();
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const gate = new ApproverGate(requests, approvers);

    await expect(gate.resolve('missing', 'token-bob')).rejects.toThrow(UnknownRequestError);
  });

  it('resolves the ACTIVE approver for a valid token on a non-terminal request', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository().seed('req-1', activeGate());
    const gate = new ApproverGate(requests, approvers);

    const approver = await gate.resolve('req-1', 'token-bob');
    expect(approver.email).toBe('bob@example.com');
    expect(approver.tokenStatus).toBe('ACTIVE');
  });

  it('4th check: an approver who already signed is rejected with already-acted (409)', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository().seed(
      'req-1',
      activeGate({ status_signed: '2026-08-14T09:00:00.000Z' })
    );
    const gate = new ApproverGate(requests, approvers);

    await expect(gate.resolve('req-1', 'token-bob')).rejects.toThrow(AlreadyActedError);
  });

  it('4th check: an approver who already rejected is rejected with already-acted (409)', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail());
    const approvers = new FakeApproverRepository().seed(
      'req-1',
      activeGate({ status_rejected: '2026-08-14T09:00:00.000Z' })
    );
    const gate = new ApproverGate(requests, approvers);

    await expect(gate.resolve('req-1', 'token-bob')).rejects.toThrow(AlreadyActedError);
  });

  it('4th check is checked AFTER terminal global state (terminal dominates)', async () => {
    const requests = new FakeRequestRepository();
    requests.seedDetail(otpRequestDetail({ status: 'REJECTED' }));
    const approvers = new FakeApproverRepository().seed(
      'req-1',
      activeGate({ status_signed: '2026-08-14T09:00:00.000Z' })
    );
    const gate = new ApproverGate(requests, approvers);

    await expect(gate.resolve('req-1', 'token-bob')).rejects.toThrow(TerminalRequestError);
  });
});