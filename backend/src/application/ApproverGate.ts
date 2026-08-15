import { GlobalStatus } from '../domain/enums/GlobalStatus';
import {
  UnknownRequestError,
  UnknownTokenError,
  TerminalRequestError,
  LockedOutError,
  AlreadyActedError,
} from '../domain/errors';
import { RequestRepository } from './ports/RequestRepository';
import { ApproverRepository, ApproverGateState } from './ports/ApproverRepository';

/**
 * The shared eligibility gate (spec R7, design-concurrency §2), checked in
 * fixed order on durable items — a single eligibility point shared by the OTP
 * use cases (issue/validate/regenerate) and the signature use cases
 * (approve/reject):
 *
 *   1. Read REQ — `COMPLETED`/`REJECTED` → {@link TerminalRequestError} (410).
 *   2. Resolve the approver by token — unknown → {@link UnknownTokenError} (404).
 *   3. `tokenStatus = INVALIDATED_LOCKOUT` → {@link LockedOutError} (403).
 *   4. Approver already acted (`status_signed`/`status_rejected`) →
 *      {@link AlreadyActedError} (409) — no double-sign, no re-entry after
 *      acting (added in PR #4 for the signature capability).
 *
 * Terminal global state dominates: even a correct token cannot act on a
 * terminal request. Reading one REQ + the approver set is two reads, no joins.
 */
export class ApproverGate {
  constructor(
    private readonly requests: RequestRepository,
    private readonly approvers: ApproverRepository
  ) {}

  async resolve(requestId: string, token: string): Promise<ApproverGateState> {
    const detail = await this.requests.get(requestId);
    if (!detail) {
      throw new UnknownRequestError(`Request ${requestId} not found`);
    }
    if (
      detail.status === GlobalStatus.COMPLETED ||
      detail.status === GlobalStatus.REJECTED
    ) {
      throw new TerminalRequestError(
        `Request ${requestId} is already ${detail.status}; no OTP flow is offered`
      );
    }

    const approver = await this.approvers.findByToken(requestId, token);
    if (!approver) {
      throw new UnknownTokenError('Token does not resolve to this approver');
    }
    if (approver.tokenStatus === 'INVALIDATED_LOCKOUT') {
      throw new LockedOutError('Approver token is invalidated (lockout)');
    }
    if (approver.status_signed) {
      throw new AlreadyActedError('This approver already signed the request');
    }
    if (approver.status_rejected) {
      throw new AlreadyActedError('This approver already rejected the request');
    }
    return approver;
  }
}