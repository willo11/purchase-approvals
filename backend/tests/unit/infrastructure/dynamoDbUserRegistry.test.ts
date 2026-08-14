import { GetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbUserRegistry } from '../../../src/infrastructure/DynamoDbUserRegistry';

/** Minimal stand-in for DynamoDBDocumentClient with an observable send(). */
function fakeClient(): { send: jest.Mock } {
  return { send: jest.fn() };
}

function makeRegistry(client: { send: jest.Mock }): DynamoDbUserRegistry {
  return new DynamoDbUserRegistry({
    tableName: 'purchase-approvals-test',
    documentClient: client as unknown as DynamoDBDocumentClient,
  });
}

describe('DynamoDbUserRegistry', () => {
  it('resolves a registered email to its name via GetItem', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({
      Item: { email: 'ana@example.com', name: 'Ana' },
    });
    const registry = makeRegistry(client);

    const user = await registry.findByEmail('ana@example.com');

    expect(user).toEqual({ email: 'ana@example.com', name: 'Ana' });
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(GetCommand);
    expect(command.input.Key).toEqual({ PK: 'USER#ana@example.com', SK: 'USER#ana@example.com' });
  });

  it('returns undefined when the email is not registered', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const registry = makeRegistry(client);

    await expect(registry.findByEmail('ghost@example.com')).resolves.toBeUndefined();
  });
});