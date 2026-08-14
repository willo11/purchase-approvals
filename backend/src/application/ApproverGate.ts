import { GlobalStatus } from '../domain/enums/GlobalStatus';
import { UnknownRequestError, UnknownTokenError, TerminalRequestError, LockedOutError } from '../domain/errors';
import { RequestRepository } from './ports/RequestRepository';
import { ApproverRepository, ApproverGateState } from './ports/ApproverRepository';

/**
 * The shared OTP entry gate (spec R7, design-concurrency §2), checked in fixed
 * order on durable items:
 *
 *   1. Read REQ — `COMPLETED`/`REJECTED` → {@link TerminalRequestError} (410).
 *   2. Resolve the approver by token — unknown → {@link UnknownTokenError} (404).
 *   3. `tokenStatus = INVALIDATED_LOCKOUT` → {@link LockedOutError} (403).
 *
 * Terminal global state dominates: even a correct token cannot act on a
 * terminal request. Reading one REQ + the 3-item approver set is two reads, no
 * joins.
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
    return approver;
  }
}