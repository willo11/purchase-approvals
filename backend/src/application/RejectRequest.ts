import type { RequestDetail } from '../domain/PurchaseRequest';
import { AlreadyActedError } from '../domain/errors';
import { ApproverGate } from './ApproverGate';
import { ApproverRepository } from './ports/ApproverRepository';
import { RequestRepository } from './ports/RequestRepository';

export interface RejectRequestCommand {
  requestId: string;
  token: string;
}

/**
 * Reject a purchase request use case (spec approval-signature R2).
 *
 * Runs the shared {@link ApproverGate} (terminal→410, unknown token→404,
 * lockout→403, already-acted→409), then:
 *   Step A — records the rejection on this approver row via the same
 *            compare-and-swap as an approve (`attribute_not_exists(status_signed)
 *            AND attribute_not_exists(status_rejected)`), so an approver acts
 *            once.
 *   Step B — the EXCLUSIVE global reject CAS on the REQUEST item
 *            (`status = :pending AND attribute_not_exists(rejectedAt)`). Only
 *            the FIRST rejection wins and sets the request `REJECTED` (R2);
 *            after that every other approver link is blocked by the gate (410
 *            terminal). If a concurrent approve already CAS'd `COMPLETED`, this
 *            reject loses (R2 precedence COMPLETED > REJECTED) and we return the
 *            current (COMPLETED) state.
 * Pure application logic — no framework or AWS dependencies.
 */
export class RejectRequest {
  constructor(
    private readonly gate: ApproverGate,
    private readonly approvers: ApproverRepository,
    private readonly requests: RequestRepository
  ) {}

  async execute(command: RejectRequestCommand): Promise<RequestDetail> {
    const approver = await this.gate.resolve(command.requestId, command.token);
    const now = new Date().toISOString();

    const committed = await this.approvers.markRejected(command.requestId, approver.email, {
      name: approver.name,
      timestamp: now,
    });
    if (!committed) {
      throw new AlreadyActedError('This approver already signed or rejected the request');
    }

    // Step B — first-rejection-wins global CAS. A false return means a
    // concurrent approve already completed the request: the reject loses and we
    // return the current (COMPLETED) state.
    await this.requests.rejectIfPending(command.requestId, approver.email, now);

    return (await this.requests.get(command.requestId)) as RequestDetail;
  }
}