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
 * The full token/OTP implementation lands in PR #3 (approver-otp); here the
 * port is defined and a minimal callable placeholder wires it so the create
 * flow, handlers and tests compile and run in this PR.
 */
export interface TokenIssuerPort {
  /**
   * Issues a unique token per approver and the approve link of the form
   * `https://<host>/approve?request_id=<id>&approver_token=<uuid>`.
   */
  issueApprovalLink(requestId: string, approverEmail: string): ApprovalLink;
}