/**
 * A per-approver approval link: a unique token plus the URL an approver opens.
 */
export interface ApprovalLink {
  token: string;
  url: string;
}

/**
 * Issues per-approver approval tokens and approve URLs (design R1).
 *
 * Implemented by {@link TokenIssuer} in `infrastructure/`. The create use case
 * issues each approver's token ONCE and reuses it for both the persisted APPR
 * record and the mailed approve link, so the later approve flow can resolve
 * the URL token against the stored record.
 */
export interface TokenIssuerPort {
  /**
   * Issues a unique token per approver and the approve link of the form
   * `https://<host>/approve?request_id=<id>&approver_token=<uuid>`.
   */
  issueApprovalLink(requestId: string, approverEmail: string): ApprovalLink;
}