import { randomUUID } from 'node:crypto';
import { ApprovalLink, TokenIssuerPort } from '../application/ports/TokenIssuerPort';

/**
 * Minimal callable token issuer placeholder.
 *
 * Issues a unique URL-safe UUID per approver and builds the approve URL
 * `https://<host>/approve?request_id=<id>&approver_token=<uuid>` (design R1).
 *
 * // TODO(PR #3 approver-otp): real token semantics — OTP hash + TTL and
 * durable token status. This placeholder is enough for the create flow,
 * handlers and tests to compile and run in PR #2.
 */
export class InMemoryTokenIssuer implements TokenIssuerPort {
  constructor(private readonly host = 'http://localhost:4000') {}

  issueApprovalLink(requestId: string, _approverEmail: string): ApprovalLink {
    const token = randomUUID();
    const url = `${this.host}/approve?request_id=${encodeURIComponent(requestId)}&approver_token=${encodeURIComponent(token)}`;
    return { token, url };
  }
}