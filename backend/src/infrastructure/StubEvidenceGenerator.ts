import type { RequestDetail } from '../domain/PurchaseRequest';
import type { EvidenceGeneratorPort } from '../application/ports/EvidenceGeneratorPort';

/**
 * Placeholder for {@link EvidenceGeneratorPort} used in PR #4 wiring: the
 * completion CAS winner calls it, but the real PDF generator ships in PR #5
 * (`pdf-evidence`). Compiling out an empty byte array keeps the seam exercised
 * end-to-end while the real implementation is pending.
 */
export class StubEvidenceGenerator implements EvidenceGeneratorPort {
  async generate(_request: RequestDetail): Promise<Uint8Array> {
    return new Uint8Array(0);
  }
}