import {
  ApprovalLink,
  TokenIssuerPort,
} from '../../../src/application/ports/TokenIssuerPort';

/**
 * Deterministic fake for the {@link TokenIssuerPort}.
 *
 * Returns incremental tokens and observable urls so tests can assert that
 * tokens are unique per approver and mail links carry the request/token.
 */
export class FakeTokenIssuer implements TokenIssuerPort {
  issueCalls = 0;
  private counter = 0;

  issueApprovalLink(requestId: string, approverEmail: string): ApprovalLink {
    this.counter += 1;
    return {
      token: `token-${this.counter}-${approverEmail}`,
      url: `https://host/approve?request_id=${encodeURIComponent(requestId)}&approver_token=token-${this.counter}-${approverEmail}`,
    };
  }
}