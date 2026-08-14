/**
 * A simulated mail event (design `MailEvent` shape). `type` is always
 * `APPROVAL_LINK` in this PR; OTP mails arrive with PR #3.
 */
export interface MailEvent {
  id: string;
  to: string;
  type: 'APPROVAL_LINK';
  subject: string;
  body: string;
  link?: string;
  createdAt: string;
}

/**
 * Sends simulated approval-link mail (design Decision 11).
 *
 * The real implementation is `MockMailRepo` (MAIL type rows behind
 * `GET /mock-mail`) in PR #3. Here the port is defined and a no-op/logging
 * placeholder wires the create flow, handlers and tests in this PR.
 */
export interface MailPort {
  send(event: MailEvent): Promise<void>;
}