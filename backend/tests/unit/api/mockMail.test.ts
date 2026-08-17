import type { APIGatewayProxyEvent } from 'aws-lambda';
import { buildListMail } from '../../../src/api/handlers/mockMail';
import type { MailEvent, MailLog } from '../../../src/application/ports/MailPort';

function inMemoryLog(seed: MailEvent[] = []): MailLog & { items: MailEvent[] } {
  const items = [...seed];
  return {
    items,
    async send(event: MailEvent) {
      items.unshift(event);
    },
    async list(to?: string) {
      // newest first by createdAt (spec R2), optional recipient filter
      const ordered = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return to ? ordered.filter((event) => event.to === to) : ordered;
    },
  };
}

function listEvent(to?: string): APIGatewayProxyEvent {
  return {
    queryStringParameters: to === undefined ? null : { to },
  } as unknown as APIGatewayProxyEvent;
}

const seed: MailEvent[] = [
  {
    id: 'mail-old', to: 'carol@example.com', type: 'APPROVAL_LINK', subject: 'Link',
    body: 'Please approve.', link: 'https://e/approve', createdAt: '2026-08-14T00:01:00.000Z',
  },
  {
    id: 'mail-new', to: 'bob@example.com', type: 'OTP', subject: 'Your code',
    body: 'Code: 123456', otpPlain: '123456', createdAt: '2026-08-14T00:02:00.000Z',
  },
  {
    id: 'mail-bob-old', to: 'bob@example.com', type: 'APPROVAL_LINK', subject: 'Link',
    body: 'Please approve.', link: 'https://e/approve', createdAt: '2026-08-14T00:00:30.000Z',
  },
];

describe('GET /mock-mail handler (spec R2)', () => {
  it('returns 200 with approval-link and OTP mails, newest first', async () => {
    const log = inMemoryLog(seed);

    const response = await buildListMail(log)(listEvent());

    expect(response.statusCode).toBe(200);
    const events = JSON.parse(response.body) as MailEvent[];
    expect(events.map((e) => e.id)).toEqual(['mail-new', 'mail-old', 'mail-bob-old']);
    expect(events[0].type).toBe('OTP');
    expect(events[0].otpPlain).toBe('123456');
    expect(events[2].type).toBe('APPROVAL_LINK');
  });

  it('returns 200 with an empty array when nothing has been sent', async () => {
    const response = await buildListMail(inMemoryLog())(listEvent());
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([]);
  });

  it('filters to one recipient with ?to=, keeping newest first (demo inbox)', async () => {
    const log = inMemoryLog(seed);

    const response = await buildListMail(log)(listEvent('bob@example.com'));

    expect(response.statusCode).toBe(200);
    const events = JSON.parse(response.body) as MailEvent[];
    expect(events.map((e) => e.id)).toEqual(['mail-new', 'mail-bob-old']);
    expect(events.every((e) => e.to === 'bob@example.com')).toBe(true);
  });

  it('normalizes the ?to= recipient (trim + lowercase) before filtering', async () => {
    const log = inMemoryLog(seed);

    const response = await buildListMail(log)(listEvent('  BOB@Example.com '));

    expect(response.statusCode).toBe(200);
    const events = JSON.parse(response.body) as MailEvent[];
    expect(events.map((e) => e.id)).toEqual(['mail-new', 'mail-bob-old']);
  });

  it('rejects a malformed ?to= value with 400', async () => {
    const response = await buildListMail(inMemoryLog(seed))(listEvent('not-an-email'));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toContain('valid email');
  });

  it('returns 500 when the log fails', async () => {
    const failing: MailLog = {
      async send() {},
      async list() {
        throw new Error('DynamoDB unreachable');
      },
    };
    const response = await buildListMail(failing)(listEvent());
    expect(response.statusCode).toBe(500);
  });
});