import type { RequestDetail } from '../domain/PurchaseRequest';
import { ApproverStatus } from '../domain/enums/ApproverStatus';
import { AlreadyActedError } from '../domain/errors';
import { ApproverGate } from './ApproverGate';
import { ApproverRepository } from './ports/ApproverRepository';
import { RequestRepository } from './ports/RequestRepository';
import { EvidenceGeneratorPort } from './ports/EvidenceGeneratorPort';

export interface ApproveRequestCommand {
  requestId: string;
  token: string;
}

/**
 * Approve a purchase request use case (spec approval-signature R1/R3/R4).
 *
 * Runs the shared {@link ApproverGate} (terminal→410, unknown token→404,
 * lockout→403, already-acted→409), then records the approver's signature via
 * Step A (design-concurrency §3): a compare-and-swap `UpdateItem` on the
 * approver row gated by
 * `attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)`,
 * so one approver can never sign twice (R4). The signature uses the approver's
 * REGISTERED snapshot name from the gate (R1) — never a typed name — plus a
 * timestamp.
 *
 * Step B (task 4.2): once committed, the approver set is re-read and, ONLY when
 * 3 are signed, the EXCLUSIVE global completion CAS
 * `attribute_not_exists(completedAt)` is issued on the REQUEST item. Exactly
 * one concurrent 3rd-signature writer wins; the loser gets
 * `ConditionalCheckFailed` and returns the current state WITHOUT generating
 * evidence. The CAS winner alone calls {@link EvidenceGeneratorPort} (R3, PDF
 * shipped in PR #5). Pure application logic — no framework or AWS dependencies.
 */
export class ApproveRequest {
  constructor(
    private readonly gate: ApproverGate,
    private readonly approvers: ApproverRepository,
    private readonly requests: RequestRepository,
    private readonly evidence: EvidenceGeneratorPort
  ) {}

  async execute(command: ApproveRequestCommand): Promise<RequestDetail> {
    const approver = await this.gate.resolve(command.requestId, command.token);
    const now = new Date().toISOString();

    // Step A — per-approver idempotent signature commit. `approver.name` is the
    // registered snapshot (R1); the caller never supplies a name.
    const committed = await this.approvers.markSigned(command.requestId, approver.email, {
      name: approver.name,
      timestamp: now,
    });
    if (!committed) {
      throw new AlreadyActedError('This approver already signed or rejected the request');
    }

    await this.maybeComplete(command.requestId, now);

    return (await this.requests.get(command.requestId)) as RequestDetail;
  }

  /**
   * Step B — the completion CAS. Only the single writer that observes all 3
   * approvers signed issues it; the `attribute_not_exists(completedAt)`
   * condition guarantees a concurrent completion cannot be double-written.
   * The CAS winner generates evidence; a loser (conditional-check failure) does
   * NOT, and just returns the already-completed state (R3/R4).
   */
  private async maybeComplete(requestId: string, now: string): Promise<void> {
    const current = await this.requests.get(requestId);
    if (!current) return;

    const signedCount = current.approvers.filter(
      (a) => a.status === ApproverStatus.SIGNED
    ).length;
    if (signedCount < 3) return;

    const completed = await this.requests.completeIfAbsent(requestId, now);
    if (!completed) return; // a concurrent winner already set completedAt — do NOT generate
    const fresh = (await this.requests.get(requestId)) as RequestDetail;
    try {
      await this.evidence.generate(fresh);
    } catch {
      // Evidence generation failure leaves status `COMPLETED` and is dropped
      // (spec R4 / design-concurrency §5); download stays 404 until PR #5.
    }
  }
}