import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbApproverRepository } from '../../../src/infrastructure/DynamoDbApproverRepository';

function fakeClient(): { send: jest.Mock } {
  return { send: jest.fn() };
}

function makeRepo(client: { send: jest.Mock }): DynamoDbApproverRepository {
  return new DynamoDbApproverRepository({
    tableName: 'purchase-approvals-test',
    documentClient: client as unknown as DynamoDBDocumentClient,
  });
}

const APPR_ITEM = {
  email: 'bob@example.com',
  name: 'Bob',
  token: 'token-bob',
  tokenStatus: 'ACTIVE',
  attempts: 0,
};

describe('DynamoDbApproverRepository', () => {
  it('findByToken queries the request approver set and returns the matching gate state', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({
      Items: [
        { email: 'carol@example.com', name: 'Carol', token: 'token-carol', tokenStatus: 'ACTIVE', attempts: 0 },
        { ...APPR_ITEM },
      ],
    });
    const repo = makeRepo(client);

    const state = await repo.findByToken('req-1', 'token-bob');

    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :prefix)');
    expect(command.input.ExpressionAttributeValues).toEqual({
      ':pk': 'REQ#req-1',
      ':prefix': 'APPR#',
    });
    expect(state).toEqual({
      email: 'bob@example.com', name: 'Bob', token: 'token-bob', tokenStatus: 'ACTIVE', attempts: 0,
    });
  });

  it('findByToken returns undefined when no approver owns the token', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({ Items: [{ ...APPR_ITEM }] });
    const repo = makeRepo(client);

    await expect(repo.findByToken('req-1', 'bogus')).resolves.toBeUndefined();
  });

  it('incrementAttempts uses a conditional CAS counter and returns attempts before the limit', async () => {
    const client = fakeClient();
    // attempts goes 1 (below limit) → no secondary lockout write
    client.send.mockResolvedValue({ Attributes: { attempts: 1 } });
    const repo = makeRepo(client);

    const result = await repo.incrementAttempts('req-1', 'bob@example.com');

    expect(result).toEqual({ attempts: 1, lockedOut: false });
    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input.ConditionExpression).toContain('attempts <');
    expect(command.input.UpdateExpression).toBe('SET attempts = attempts + :one');
  });

  it('atomically locks the token out when the counter reaches the limit (secondary conditional write)', async () => {
    const client = fakeClient();
    client.send
      .mockResolvedValueOnce({ Attributes: { attempts: 3 } }) // counter reaches 3
      .mockResolvedValueOnce({}); // durable lockout set
    const repo = makeRepo(client);

    const result = await repo.incrementAttempts('req-1', 'bob@example.com');

    expect(result).toEqual({ attempts: 3, lockedOut: true });
    expect(client.send).toHaveBeenCalledTimes(2);
    const [incr, lockout] = client.send.mock.calls.map(([c]) => c);
    expect(incr).toBeInstanceOf(UpdateCommand);
    expect(lockout).toBeInstanceOf(UpdateCommand);
    expect(lockout.input.UpdateExpression).toBe('SET tokenStatus = :locked');
    expect(lockout.input.ConditionExpression).toBe('tokenStatus = :active');
  });

  it('treats a failed conditional increment as locked (no lost update / no overshoot)', async () => {
    const client = fakeClient();
    client.send.mockRejectedValue({ name: 'ConditionalCheckFailedException' });
    const repo = makeRepo(client);

    await expect(repo.incrementAttempts('req-1', 'bob@example.com')).resolves.toEqual({
      attempts: 3,
      lockedOut: true,
    });
  });

  it('resetAttemptsIfActive resets attempts only while the token is ACTIVE', async () => {
    const ok = fakeClient();
    ok.send.mockResolvedValue({});
    const repoOk = makeRepo(ok);
    await expect(repoOk.resetAttemptsIfActive('req-1', 'bob@example.com')).resolves.toBe(true);
    const [cmd] = ok.send.mock.calls[0];
    expect(cmd.input.UpdateExpression).toBe('SET attempts = :zero');

    const locked = fakeClient();
    locked.send.mockRejectedValue({ name: 'ConditionalCheckFailedException' });
    const repoLocked = makeRepo(locked);
    await expect(repoLocked.resetAttemptsIfActive('req-1', 'bob@example.com')).resolves.toBe(false);
  });
});