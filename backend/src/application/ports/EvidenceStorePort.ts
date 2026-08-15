/**
 * Port for the evidence object store (spec R2, design-concurrency §5, task
 * 5.2/5.3). The completion CAS winner persists the generated PDF through this
 * seam; the download handler reads it back.
 *
 * The key is DETERMINISTIC — `reqs/<id>/evidence.pdf` (see `evidenceKeyFor`)
 * — so a replay of the completion path OVERWRITES the same object instead of
 * duplicating it, and evidence is resolvable by request id.
 *
 * Production wiring injects the AWS {@link S3EvidenceStore}; integration tests
 * inject an in-memory store that returns REAL PDF bytes, so the evidence flow
 * is tested end-to-end without LocalStack.
 */
export interface EvidenceStorePort {
  /** Stores the PDF bytes under `key` with `ContentType: application/pdf`. */
  put(key: string, bytes: Uint8Array): Promise<void>;

  /** Returns the stored bytes for `key`, or `undefined` when no object exists. */
  get(key: string): Promise<Uint8Array | undefined>;
}
