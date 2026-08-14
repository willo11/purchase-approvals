import { MailEvent, MailPort } from '../application/ports/MailPort';

/**
 * Minimal callable mail placeholder.
 *
 * Logs the simulated approval-link mail so the create flow, handlers and
 * tests run without a mail server (design Decision 11).
 *
 * // TODO(PR #3 approver-otp): back this with MockMailRepo (MAIL#<uuid> rows)
 * so `GET /mock-mail` can return sent events. No-op/logging is enough for the
 * create flow in PR #2.
 */
export class LogMailer implements MailPort {
  async send(event: MailEvent): Promise<void> {
    // eslint is not configured; keep the log side-effectful on purpose.
    // eslint-disable-next-line no-console
    console.log(
      `[mock-mail] to=${event.to} type=${event.type} subject=${event.subject} link=${event.link ?? ''}`
    );
  }
}