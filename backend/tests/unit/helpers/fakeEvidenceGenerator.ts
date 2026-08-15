import type { RequestDetail } from '../../../src/domain/PurchaseRequest';
import type { EvidenceGeneratorPort } from '../../../src/application/ports/EvidenceGeneratorPort';

/**
 * In-memory fake for {@link EvidenceGeneratorPort}: records invocation count and
 * the request passed, so unit tests can assert only the completion CAS winner
 * triggers evidence generation (task 4.2/4.4).
 */
export class FakeEvidenceGenerator implements EvidenceGeneratorPort {
  calls = 0;
  lastRequest?: RequestDetail;

  async generate(request: RequestDetail): Promise<Uint8Array> {
    this.calls += 1;
    this.lastRequest = request;
    return new Uint8Array(0);
  }
}