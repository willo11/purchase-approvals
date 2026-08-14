import { MailEvent, MailPort } from '../../../src/application/ports/MailPort';

/**
 * In-memory fake for the {@link MailPort}.
 *
 * Records every simulated mail so tests can assert one APPROVAL_LINK per
 * approver.
 */
export class FakeMailPort implements MailPort {
  events: MailEvent[] = [];
  sendCalls = 0;

  async send(event: MailEvent): Promise<void> {
    this.sendCalls += 1;
    this.events.push(event);
  }
}