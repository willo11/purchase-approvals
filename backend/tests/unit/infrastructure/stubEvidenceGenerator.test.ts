import { StubEvidenceGenerator } from '../../../src/infrastructure/StubEvidenceGenerator';
import { otpRequestDetail } from '../helpers/otpFixture';

/**
 * The PR #4 seam for {@link EvidenceGeneratorPort}: the completion CAS winner
 * calls it; the real PdfGenerator replaces it in PR #5. This proves the stub
 * satisfies the contract without AWS.
 */
describe('StubEvidenceGenerator', () => {
  it('satisfies EvidenceGeneratorPort and returns empty bytes', async () => {
    const stub = new StubEvidenceGenerator();
    const bytes = await stub.generate(otpRequestDetail({ status: 'COMPLETED' }));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(0);
  });
});