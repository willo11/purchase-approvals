import { buildListMail } from '../../../src/api/handlers/mockMail';
import type { MailEvent, MailLog } from '../../../src/application/ports/MailPort';

function inMemoryLog(seed: MailEvent[] = []): MailLog & { items: MailEvent[] } {
  const items = [...seed];
  return {
    items,
    async send(event: MailEvent) {
      items.unshift(event);
    },
    async list() {
      // newest first by createdAt (spec R2)
      return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}

describe('GET /mock-mail handler (spec R2)', () => {
  it('returns 200 with approval-link and OTP mails, newest first', async () => {
    const log = inMemoryLog([
      {
        id: 'mail-old', to: 'carol@example.com', type: 'APPROVAL_LINK', subject: 'Link',
        body: 'Please approve.', link: 'https://e/approve', createdAt: '2026-08-14T00:01:00.000Z',
      },
      {
        id: 'mail-new', to: 'bob@example.com', type: 'OTP', subject: 'Your code',
        body: 'Code: 123456', otpPlain: '123456', createdAt: '2026-08-14T00:02:00.000Z',
      },
    ]);

    const response = await buildListMail(log)();

    expect(response.statusCode).toBe(200);
    const events = JSON.parse(response.body) as MailEvent[];
    expect(events.map((e) => e.id)).toEqual(['mail-new', 'mail-old']);
    expect(events[0].type).toBe('OTP');
    expect(events[0].otpPlain).toBe('123456');
    expect(events[1].type).toBe('APPROVAL_LINK');
  });

  it('returns 200 with an empty array when nothing has been sent', async () => {
    const response = await buildListMail(inMemoryLog())();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([]);
  });

  it('returns 500 when the log fails', async () => {
    const failing: MailLog = {
      async send() {},
      async list() {
        throw new Error('DynamoDB unreachable');
      },
    };
    const response = await buildListMail(failing)();
    expect(response.statusCode).toBe(500);
  });
});