import { Token } from '../domain/values/Token';
import { ApprovalLink, TokenIssuerPort } from '../application/ports/TokenIssuerPort';

/**
 * Real {@link TokenIssuerPort} implementation (spec R1, task 3.2).
 *
 * Issues a unique URL-safe UUID token per approver and builds the approve link
 * `https://<host>/approve?request_id=<id>&approver_token=<uuid>`. The token is
 * produced ONCE per approver by the create use case and reused for both the
 * persisted APPR record and the mailed link, so the approve flow (later PRs)
 * can resolve the URL token against the stored record. Stateless.
 */
export class TokenIssuer implements TokenIssuerPort {
  constructor(private readonly host = process.env.APPROVER_BASE_URL ?? 'http://localhost:4000') {}

  issueApprovalLink(requestId: string, _approverEmail: string): ApprovalLink {
    const token = Token.urlSafe().toString();
    const url = `${this.host}/approve?request_id=${encodeURIComponent(requestId)}&approver_token=${encodeURIComponent(token)}`;
    return { token, url };
  }
}