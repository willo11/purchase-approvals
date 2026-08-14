import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { MockMailRepo } from '../../../src/infrastructure/MockMailRepo';

function fakeClient(): { send: jest.Mock } {
  return { send: jest.fn() };
}

function makeRepo(client: { send: jest.Mock }): MockMailRepo {
  return new MockMailRepo({
    tableName: 'purchase-approvals-test',
    documentClient: client as unknown as DynamoDBDocumentClient,
  });
}

describe('MockMailRepo (spec R2)', () => {
  it('send writes a MAIL row with PK/SK=MAIL#<id>, gsi1pk=MAIL, gsi1sk=createdAt', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const repo = makeRepo(client);

    await repo.send({
      id: 'mail-1',
      to: 'bob@example.com',
      type: 'OTP',
      subject: 'Your code',
      body: 'Code: 123456',
      otpPlain: '123456',
      createdAt: '2026-08-14T00:00:00.000Z',
    });

    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input.Item.PK).toBe('MAIL#mail-1');
    expect(command.input.Item.SK).toBe('MAIL#mail-1');
    expect(command.input.Item.gsi1pk).toBe('MAIL');
    expect(command.input.Item.gsi1sk).toBe('2026-08-14T00:00:00.000Z');
    expect(command.input.Item.type).toBe('OTP');
    expect(command.input.Item.otpPlain).toBe('123456');
  });

  it('send omits otpPlain when it is absent (approval-link shape preserved)', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const repo = makeRepo(client);

    await repo.send({
      id: 'mail-2',
      to: 'carol@example.com',
      type: 'APPROVAL_LINK',
      subject: 'Approval needed: Laptop',
      body: 'Please approve.',
      link: 'https://example.com/approve?request_id=req-1&approver_token=t',
      createdAt: '2026-08-14T00:00:01.000Z',
    });

    const [command] = client.send.mock.calls[0];
    expect(command.input.Item.otpPlain).toBeUndefined();
    expect(command.input.Item.link).toContain('request_id=req-1');
  });

  it('list queries GSI1 newest first and rehydrates MailEvents', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({
      Items: [
        {
          id: 'mail-new', to: 'bob@example.com', type: 'OTP', subject: 'Your code',
          body: 'Code: 111111', otpPlain: '111111', createdAt: '2026-08-14T00:02:00.000Z',
        },
        {
          id: 'mail-old', to: 'carol@example.com', type: 'APPROVAL_LINK', subject: 'Link',
          body: 'Please approve.', link: 'https://e/approve', createdAt: '2026-08-14T00:01:00.000Z',
        },
      ],
    });
    const repo = makeRepo(client);

    const events = await repo.list();

    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input.IndexName).toBe('GSI1');
    expect(command.input.KeyConditionExpression).toBe('gsi1pk = :type');
    expect(command.input.ExpressionAttributeValues).toEqual({ ':type': 'MAIL' });
    expect(command.input.ScanIndexForward).toBe(false);

    // newest first preserved from the query
    expect(events.map((e) => e.id)).toEqual(['mail-new', 'mail-old']);
    expect(events[0]).toEqual({
      id: 'mail-new', to: 'bob@example.com', type: 'OTP', subject: 'Your code',
      body: 'Code: 111111', otpPlain: '111111', createdAt: '2026-08-14T00:02:00.000Z',
    });
  });

  it('list returns [] when the query yields no items', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({ Items: undefined });
    const repo = makeRepo(client);

    await expect(repo.list()).resolves.toEqual([]);
  });
});