import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbUserRepository } from '../../../src/infrastructure/DynamoDbUserRepository';
import { User } from '../../../src/domain/User';
import { UserAlreadyExistsError } from '../../../src/domain/errors';

/** Minimal stand-in for DynamoDBDocumentClient with an observable send(). */
function fakeClient(): { send: jest.Mock } {
  return { send: jest.fn() };
}

/** Widens the typed client into a DocumentClient for the adapter constructor. */
function makeRepo(client: { send: jest.Mock }): DynamoDbUserRepository {
  return new DynamoDbUserRepository({
    tableName: 'purchase-approvals-test',
    documentClient: client as unknown as DynamoDBDocumentClient,
  });
}

describe('DynamoDbUserRepository', () => {


  it('save puts a USER row keyed by email with a no-overwrite condition', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const repo = makeRepo(client);

    await repo.save(User.create({ name: 'Ana', email: 'ana@example.com', cargo: 'Contadora' }));

    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input.TableName).toBe('purchase-approvals-test');
    expect(command.input.ConditionExpression).toBe('attribute_not_exists(PK)');

    const item = command.input.Item;
    expect(item.PK).toBe('USER#ana@example.com');
    expect(item.SK).toBe('USER#ana@example.com');
    expect(item.gsi1pk).toBe('USER');
    expect(item.name).toBe('Ana');
    expect(item.cargo).toBe('Contadora');
    expect(typeof item.gsi1sk).toBe('string'); // createdAt ISO → creation order
  });

  it('save maps a conditional-check failure to UserAlreadyExistsError (no overwrite)', async () => {
    const client = fakeClient();
    client.send.mockRejectedValue(
      new ConditionalCheckFailedException({
        $metadata: {},
        message: 'The conditional request failed',
      })
    );
    const repo = makeRepo(client);

    await expect(
      repo.save(User.create({ name: 'Ana', email: 'ana@example.com' }))
    ).rejects.toThrow(UserAlreadyExistsError);
  });

  it('save rethrows non-conditional errors untouched', async () => {
    const client = fakeClient();
    const unexpected = new Error('connection refused');
    client.send.mockRejectedValue(unexpected);
    const repo = makeRepo(client);

    await expect(repo.save(User.create({ name: 'Ana', email: 'ana@example.com' }))).rejects.toBe(
      unexpected
    );
  });

  it('listAll queries GSI1 by the USER type in ascending (creation) order', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({
      Items: [
        { name: 'Ana', email: 'ana@example.com', cargo: 'Contadora' },
        { name: 'Bob', email: 'bob@example.com', cargo: 'Gerente' },
      ],
    });
    const repo = makeRepo(client);

    const users = await repo.listAll();

    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input.IndexName).toBe('GSI1');
    expect(command.input.KeyConditionExpression).toBe('gsi1pk = :type');
    expect(command.input.ScanIndexForward).toBe(true);

    expect(users.map((u) => u.getEmail().toString())).toEqual([
      'ana@example.com',
      'bob@example.com',
    ]);
  });

  it('listAll returns an empty array when the query yields no items', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({ Items: undefined });
    const repo = makeRepo(client);

    await expect(repo.listAll()).resolves.toEqual([]);
  });
});