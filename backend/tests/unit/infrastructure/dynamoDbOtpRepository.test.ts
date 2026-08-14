import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbOtpRepository } from '../../../src/infrastructure/DynamoDbOtpRepository';

function fakeClient(): { send: jest.Mock } {
  return { send: jest.fn() };
}

function makeRepo(client: { send: jest.Mock }): DynamoDbOtpRepository {
  return new DynamoDbOtpRepository({
    tableName: 'purchase-approvals-test',
    documentClient: client as unknown as DynamoDBDocumentClient,
  });
}

const KEY = 'OTP#req-1#bob@example.com';

describe('DynamoDbOtpRepository (spec R3/R4)', () => {
  it('putOtp writes a dedicated TTL item holding only the digest and otpExpiresAt', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const repo = makeRepo(client);

    await repo.putOtp('req-1', 'bob@example.com', 'abcdef0123', 1800000000);

    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input.Item.PK).toBe(KEY);
    expect(command.input.Item.SK).toBe(KEY);
    expect(command.input.Item.otpHash).toBe('abcdef0123');
    expect(command.input.Item.otpExpiresAt).toBe(1800000000); // also the TTL attribute
  });

  it('getOtp returns the stored digest and expiry, or undefined when missing', async () => {
    const client = fakeClient();
    client.send
      .mockResolvedValueOnce({
        Item: { PK: KEY, SK: KEY, otpHash: 'hash1', otpExpiresAt: 1800000000 },
      })
      .mockResolvedValueOnce({});
    const repo = makeRepo(client);

    await expect(repo.getOtp('req-1', 'bob@example.com')).resolves.toEqual({
      otpHash: 'hash1',
      otpExpiresAt: 1800000000,
    });
    await expect(repo.getOtp('req-1', 'ghost@example.com')).resolves.toBeUndefined();

    const [g1, g2] = client.send.mock.calls.map(([c]) => c);
    expect(g1).toBeInstanceOf(GetCommand);
    expect(g1.input.Key).toEqual({ PK: KEY, SK: KEY });
    expect(g2).toBeInstanceOf(GetCommand);
  });

  it('deleteOtp removes the item by key (consume, one-time use)', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const repo = makeRepo(client);

    await repo.deleteOtp('req-1', 'bob@example.com');

    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(DeleteCommand);
    expect(command.input.Key).toEqual({ PK: KEY, SK: KEY });
  });
});