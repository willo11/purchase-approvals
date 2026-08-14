import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbRequestRepository } from '../../../src/infrastructure/DynamoDbRequestRepository';
import { PurchaseRequest } from '../../../src/domain/PurchaseRequest';

/** Minimal stand-in for DynamoDBDocumentClient with an observable send(). */
function fakeClient(): { send: jest.Mock } {
  return { send: jest.fn() };
}

function makeRepo(client: { send: jest.Mock }): DynamoDbRequestRepository {
  return new DynamoDbRequestRepository({
    tableName: 'purchase-approvals-test',
    documentClient: client as unknown as DynamoDBDocumentClient,
  });
}

function makeRequest() {
  const draft = PurchaseRequest.validateDraft({
    title: 'Laptop',
    description: 'Work machine',
    amount: 1200.5,
    requesterEmail: 'ana@example.com',
    approverEmails: ['bob@example.com', 'carol@example.com', 'dave@example.com'],
  });
  return PurchaseRequest.assemble({
    id: 'req-1',
    createdAt: '2026-08-14T00:00:00.000Z',
    draft,
    requesterName: 'Ana',
    approverNames: ['Bob', 'Carol', 'Dave'],
  });
}

describe('DynamoDbRequestRepository', () => {
  it('create writes a REQ row plus 3 APPR rows with correct keys', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const repo = makeRepo(client);
    const request = makeRequest();

    await repo.create(request, [
      { email: 'bob@example.com', name: 'Bob', token: 't-bob' },
      { email: 'carol@example.com', name: 'Carol', token: 't-carol' },
      { email: 'dave@example.com', name: 'Dave', token: 't-dave' },
    ]);

    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    // ONE TransactWriteItems carrying 4 Put statements: REQ + 3 APPR
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toHaveLength(4);
    expect(command.input.TransactItems.every((t: { Put?: unknown }) => t.Put)).toBe(true);

    const reqPut = command.input.TransactItems[0].Put;
    expect(reqPut.Item.PK).toBe('REQ#req-1');
    expect(reqPut.Item.SK).toBe('REQ#req-1');
    expect(reqPut.Item.gsi1pk).toBe('REQ');
    expect(reqPut.Item.gsi1sk).toBe('2026-08-14T00:00:00.000Z');
    expect(reqPut.Item.status).toBe('PENDING');
    expect(reqPut.Item.createdBy).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(reqPut.Item.approvers).toHaveLength(3);

    const transactItems = command.input.TransactItems as Array<{
      Put?: { Item?: Record<string, unknown> };
    }>;
    const apprPuts = transactItems
      .slice(1)
      .map((t) => (t.Put?.Item ?? {}) as { SK: string; token?: string; tokenStatus?: string; attempts?: number });
    expect(apprPuts.map((p) => p.SK)).toEqual([
      'APPR#bob@example.com',
      'APPR#carol@example.com',
      'APPR#dave@example.com',
    ]);
    expect(apprPuts[0].token).toBe('t-bob');
    expect(apprPuts[0].tokenStatus).toBe('ACTIVE');
    expect(apprPuts[0].attempts).toBe(0);
  });

  it('list queries GSI1 newest first and maps summaries', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({
      Items: [
        { id: 'req-2', title: 'Newer', amount: 20, currency: 'USD', status: 'PENDING', createdAt: '2026-08-10T00:00:00.000Z' },
        { id: 'req-1', title: 'Older', amount: 10, currency: 'USD', status: 'PENDING', createdAt: '2026-08-01T00:00:00.000Z' },
      ],
    });
    const repo = makeRepo(client);

    const summaries = await repo.list();

    expect(client.send).toHaveBeenCalledTimes(1);
    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input.IndexName).toBe('GSI1');
    expect(command.input.KeyConditionExpression).toBe('gsi1pk = :type');
    expect(command.input.ExpressionAttributeValues).toEqual({ ':type': 'REQ' });
    expect(command.input.ScanIndexForward).toBe(false);

    expect(summaries[0].id).toBe('req-2');
    expect(summaries[1].id).toBe('req-1');
  });

  it('get assembles REQ + approver set deriving per-approver status', async () => {
    const client = fakeClient();
    client.send
      .mockResolvedValueOnce({
        Item: {
          id: 'req-1',
          title: 'Laptop',
          description: 'Work machine',
          amount: 1200.5,
          currency: 'USD',
          status: 'PENDING',
          createdBy: { email: 'ana@example.com', name: 'Ana' },
          createdAt: '2026-08-14T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        Items: [
          { email: 'bob@example.com', name: 'Bob', status_signed: '2026-08-14T00:00:01.000Z' },
          { email: 'carol@example.com', name: 'Carol', status_rejected: '2026-08-14T00:00:02.000Z' },
          { email: 'dave@example.com', name: 'Dave' },
        ],
      });
    const repo = makeRepo(client);

    const detail = await repo.get('req-1');

    expect(detail).toBeDefined();
    expect(detail!.approvers.map((a) => a.status)).toEqual(['SIGNED', 'REJECTED', 'PENDING']);
    expect(detail!.approvers[0].signedAt).toBe('2026-08-14T00:00:01.000Z');

    const [getCmd, queryCmd] = client.send.mock.calls.map(([c]) => c);
    expect(getCmd).toBeInstanceOf(GetCommand);
    expect(getCmd.input.Key).toEqual({ PK: 'REQ#req-1', SK: 'REQ#req-1' });
    expect(queryCmd).toBeInstanceOf(QueryCommand);
    expect(queryCmd.input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :appr)');
  });

  it('get returns undefined when the REQ item is missing', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const repo = makeRepo(client);

    await expect(repo.get('missing')).resolves.toBeUndefined();
    expect(client.send).toHaveBeenCalledTimes(1); // never queries approvers
  });

  it('list returns an empty array when the query yields no items', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({ Items: undefined });
    const repo = makeRepo(client);

    await expect(repo.list()).resolves.toEqual([]);
  });
});