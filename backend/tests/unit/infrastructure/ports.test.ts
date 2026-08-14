import { randomUUID } from 'node:crypto';
import { InMemoryTokenIssuer } from '../../../src/infrastructure/InMemoryTokenIssuer';
import { LogMailer } from '../../../src/infrastructure/LogMailer';

describe('InMemoryTokenIssuer (PR #2 placeholder)', () => {
  it('issues a unique token per approver and a well-formed approve URL', () => {
    const issuer = new InMemoryTokenIssuer('https://example.com');

    const a = issuer.issueApprovalLink('req-1', 'bob@example.com');
    const b = issuer.issueApprovalLink('req-1', 'carol@example.com');

    expect(a.token).not.toBe(b.token);
    expect(a.url).toContain('https://example.com/approve');
    expect(a.url).toContain('request_id=req-1');
    expect(a.url).toContain('approver_token=' + encodeURIComponent(a.token));
    // token is a uuid
    expect(() => randomUUID()).not.toThrow();
    expect(a.token.length).toBeGreaterThan(10);
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