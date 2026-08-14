import { randomUUID } from 'node:crypto';
import { TokenIssuer } from '../../../src/infrastructure/TokenIssuer';
import { LogMailer } from '../../../src/infrastructure/LogMailer';

describe('TokenIssuer (spec R1)', () => {
  it('issues a unique URL-safe uuid token per approver and a well-formed approve URL', () => {
    const issuer = new TokenIssuer('https://example.com');

    const a = issuer.issueApprovalLink('req-1', 'bob@example.com');
    const b = issuer.issueApprovalLink('req-1', 'carol@example.com');

    // unique UUID per approver (R1 scenario "unique tokens per approver")
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[0-9a-f-]{36}$/);

    // link form https://<host>/approve?request_id=<id>&approver_token=<uuid>
    expect(a.url).toBe(
      `https://example.com/approve?request_id=req-1&approver_token=${encodeURIComponent(a.token)}`
    );
    const parsed = new URL(a.url);
    expect(parsed.searchParams.get('request_id')).toBe('req-1');
    expect(parsed.searchParams.get('approver_token')).toBe(a.token);
    expect(randomUUID()).toBeDefined();
  });
});

describe('LogMailer (PR #2 placeholder)', () => {
  it('sends (logs) the mail without throwing', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const mailer = new LogMailer();

    await expect(
      mailer.send({
        id: 'mail-1',
        to: 'bob@example.com',
        type: 'APPROVAL_LINK',
        subject: 'Approval needed: Laptop',
        body: 'Please approve.',
        link: 'https://example.com/approve?request_id=req-1',
        createdAt: '2026-08-14T00:00:00.000Z',
      })
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});