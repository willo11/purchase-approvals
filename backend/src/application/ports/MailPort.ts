/**
 * A simulated mail event (design-api `MailEvent` shape). `type` distinguishes
 * the approval-link mail (from create, keeps its existing shape) from the OTP
 * mail (this PR). `otpPlain` is the demo/QA disclosure of the plain code and
 * is NEVER stored hashed in the domain — it only rides on the simulated mail.
 */
export interface MailEvent {
  id: string;
  to: string;
  type: 'APPROVAL_LINK' | 'OTP';
  subject: string;
  body: string;
  link?: string;
  otpPlain?: string;
  createdAt: string;
}

/**
 * Sends simulated mail (design Decision 11). Implemented by `MockMailRepo`
 * (MAIL type rows behind `GET /mock-mail`) so sent events are visible to demo
 * and QA.
 */
export interface MailPort {
  send(event: MailEvent): Promise<void>;
}

/**
 * A {@link MailPort} that also records history for `GET /mock-mail`, newest
 * first (spec R2). `MockMailRepo` implements it; the mock-mail handler depends
 * only on this view.
 */
export interface MailLog extends MailPort {
  list(): Promise<MailEvent[]>;
}