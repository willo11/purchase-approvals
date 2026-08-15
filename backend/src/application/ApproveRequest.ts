import type { RequestDetail } from '../domain/PurchaseRequest';
import { ApproverStatus } from '../domain/enums/ApproverStatus';
import { AlreadyActedError, OtpNotValidatedError } from '../domain/errors';
import { ApproverGate } from './ApproverGate';
import { ApproverRepository } from './ports/ApproverRepository';
import { RequestRepository } from './ports/RequestRepository';
import { EvidenceGeneratorPort } from './ports/EvidenceGeneratorPort';
import { EvidenceStorePort } from './ports/EvidenceStorePort';
import { evidenceKeyFor } from './evidenceKey';

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
 * Step B (task 4.2/5.3): once committed, the approver set is re-read and, ONLY
 * when 3 are signed, the EXCLUSIVE global completion CAS
 * `attribute_not_exists(completedAt)` is issued on the REQUEST item. Exactly
 * one concurrent 3rd-signature writer wins; the loser gets
 * `ConditionalCheckFailed` and returns the current state WITHOUT generating
 * evidence (R3/R4). The CAS winner alone runs the evidence path
 * (design-concurrency §5): generate → store.put under the deterministic
 * `reqs/<id>/evidence.pdf` key → conditional `UpdateItem SET evidenceKey` with
 * `attribute_not_exists(evidenceKey)` (idempotent — a replay never double-sets).
 * On generation OR upload failure the request KEEPS `COMPLETED` and no
 * `evidenceKey` is recorded, so download stays 404 until a successful
 * generation exists (spec R4). Pure application logic — no framework or AWS
 * dependencies; both ports are swappable (S3 adapter / in-memory store).
 */
export class ApproveRequest {
  constructor(
    private readonly gate: ApproverGate,
    private readonly approvers: ApproverRepository,
    private readonly requests: RequestRepository,
    private readonly evidence: EvidenceGeneratorPort,
    private readonly evidenceStore: EvidenceStorePort
  ) {}

  async execute(command: ApproveRequestCommand): Promise<RequestDetail> {
    const approver = await this.gate.resolve(command.requestId, command.token);
    // Validated-OTP precondition (spec R1/R2, design-api 401): approve takes no
    // code, so the approver must have proven OTP possession earlier — the
    // durable `validatedAt` marker written by a successful ValidateOtp. Not in
    // the shared gate: OTP issue/validate/regenerate must not require it.
    if (!approver.validatedAt) {
      throw new OtpNotValidatedError(
        'Approver must validate an OTP before approving the request'
      );
    }
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
   *
   * Evidence wiring (task 5.3, design-concurrency §5): the winner
   * generate → store.put(deterministic key) → `recordEvidence`
   * (`attribute_not_exists(evidenceKey)` conditional). Any failure in that
   * chain is logged and swallowed — the request KEEPS `COMPLETED` with no
   * `evidenceKey` (spec R4). The pre-CAS `evidenceKey` read is the idempotency
   * guard: a replayed/retried completion that already recorded evidence skips
   * generation entirely.
   */
  private async maybeComplete(requestId: string, now: string): Promise<void> {
    const current = await this.requests.get(requestId);
    if (!current) return;
    // Idempotency read guard (design-concurrency §5): evidence already recorded
    // → a redelivered/double execution must not generate again.
    if (current.evidenceKey) return;

    const signedCount = current.approvers.filter(
      (a) => a.status === ApproverStatus.SIGNED
    ).length;
    if (signedCount < 3) return;

    const completed = await this.requests.completeIfAbsent(requestId, now);
    if (!completed) return; // a concurrent winner already set completedAt — do NOT generate
    const fresh = (await this.requests.get(requestId)) as RequestDetail;
    try {
      const evidenceKey = evidenceKeyFor(fresh.id);
      const pdfBytes = await this.evidence.generate(fresh);
      await this.evidenceStore.put(evidenceKey, pdfBytes);
      await this.requests.recordEvidence(fresh.id, evidenceKey);
    } catch (err) {
      // Generation or upload failure (spec R4): log, keep `COMPLETED`, do NOT
      // set `evidenceKey` — download stays 404 until a successful generation.
      console.error(
        `[evidence] generation or upload failed for request ${requestId}; status stays COMPLETED`,
        err
      );
    }
  }
}