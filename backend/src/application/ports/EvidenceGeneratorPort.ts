import type { RequestDetail } from '../../domain/PurchaseRequest';

/**
 * Port for producing the PDF evidence of a completed request (spec R3,
 * design-concurrency §5). Declared here so the completion path (the CASE
 * winner of the 3rd-signature transition) calls it ONLY on the single-winner
 * branch; the real implementation is `PdfGenerator` in PR #5. Unit tests and
 * the PR #4 handler inject a stub.
 *
 * The producer returns the PDF bytes; storing them (S3) and recording
 * `evidenceKey` is task 5.2/5.3.
 */
export interface EvidenceGeneratorPort {
  /**
   * Renders an evidence PDF for a request that legally reached `COMPLETED`.
   * `request` carries `createdBy.name` (the "Requester") and the approver set
   * with their signed timestamps.
   */
  generate(request: RequestDetail): Promise<Uint8Array>;
}