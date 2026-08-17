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
    // common increment succeeds (attempts 0 → 1), well below the limit
    client.send.mockResolvedValue({ Attributes: { attempts: 1 } });
    const repo = makeRepo(client);

    const result = await repo.incrementAttempts('req-1', 'bob@example.com');

    expect(result).toEqual({ attempts: 1, lockedOut: false });
    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    // counter can never reach the limit here — the lockout transition owns 3
    expect(command.input.ConditionExpression).toContain('attempts <');
    expect(command.input.UpdateExpression).toBe('SET attempts = attempts + :one');
  });

  it('atomically locks the token out on the 3rd failure in a SINGLE conditional update (no live counter=3 state)', async () => {
    const client = fakeClient();
    // common increment fails (counter already at limitMinusOne) → atomic
    // transition write sets attempts=3 AND tokenStatus=locks together
    client.send
      .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
      .mockResolvedValueOnce({});
    const repo = makeRepo(client);

    const result = await repo.incrementAttempts('req-1', 'bob@example.com');

    expect(result).toEqual({ attempts: 3, lockedOut: true });
    expect(client.send).toHaveBeenCalledTimes(2);
    const [incr, transition] = client.send.mock.calls.map(([c]) => c);
    expect(incr).toBeInstanceOf(UpdateCommand);
    expect(transition).toBeInstanceOf(UpdateCommand);
    // ONE atomic update: increment AND lockout land in the same write, guarded
    // by `attempts = :limitMinusOne` — so no overshoot and no ACTIVE counter=3.
    expect(transition.input.UpdateExpression).toBe(
      'SET attempts = attempts + :one, tokenStatus = :locked'
    );
    expect(transition.input.ConditionExpression).toContain('attempts =');
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

  it('recoverIfLocked resets a LOCKED approver to ACTIVE with a CAS on tokenStatus=locked', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const repo = makeRepo(client);

    const ok = await repo.recoverIfLocked('req-1', 'bob@example.com', { resetAttemptsTo: 0 });

    expect(ok).toBe(true);
    const [cmd] = client.send.mock.calls[0];
    expect(cmd).toBeInstanceOf(UpdateCommand);
    // one atomic conditional update: reset attempts, ACTIVE, clear validatedAt,
    // guarded by `tokenStatus = :locked` (compare-and-swap, DECISIONS #25)
    expect(cmd.input.UpdateExpression).toBe(
      'SET attempts = :zero, tokenStatus = :active REMOVE validatedAt'
    );
    expect(cmd.input.ConditionExpression).toBe('tokenStatus = :locked');
    expect(cmd.input.ExpressionAttributeValues).toMatchObject({
      ':zero': 0,
      ':active': 'ACTIVE',
      ':locked': 'INVALIDATED_LOCKOUT',
    });
  });

  it('recoverIfLocked returns false (not recovered) when the approver is NOT locked → 409 path', async () => {
    const client = fakeClient();
    client.send.mockRejectedValue({ name: 'ConditionalCheckFailedException' });
    const repo = makeRepo(client);

    await expect(
      repo.recoverIfLocked('req-1', 'bob@example.com', { resetAttemptsTo: 0 })
    ).resolves.toBe(false);
  });
});