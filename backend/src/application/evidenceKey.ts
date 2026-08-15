/**
 * Deterministic S3 object key for a request's evidence PDF (spec R2,
 * design-concurrency §5, task 5.3).
 *
 * The key is derived ONLY from the request id (`reqs/<id>/evidence.pdf`), so:
 *   - a replayed completion path OVERWRITES the same object instead of
 *     duplicating it (PutObject is idempotent per key), and
 *   - evidence is resolvable by id, satisfying the R2 "retrieve by id"
 *     requirement without any stored mapping.
 */
export function evidenceKeyFor(requestId: string): string {
  return `reqs/${requestId}/evidence.pdf`;
}
