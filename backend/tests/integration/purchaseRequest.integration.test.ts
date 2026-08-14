import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbRequestRepository } from '../../src/infrastructure/DynamoDbRequestRepository';
import { DynamoDbUserRegistry } from '../../src/infrastructure/DynamoDbUserRegistry';
import { PurchaseRequest } from '../../src/domain/PurchaseRequest';

/**
 * Integration test (task 2.7) — real DynamoDB round-trip against dynamodb-local.
 *
 * Gated by `DYNAMODB_LOCAL` (e.g. http://localhost:8000). Creates its own
 * single-table (PK/SK + GSI1), proves create writes REQ + 3 APPR records,
 * list orders newest first via GSI1, detail assembles the approver set, and an
 * unknown id returns undefined (→404). Seeds a USER row so the registry port
 * can resolve names.
 */
const maybeDescribe = process.env.DYNAMODB_LOCAL ? describe : describe.skip;

const TABLE_NAME = 'purchase-approvals-request-integration';
const ENDPOINT = process.env.DYNAMODB_LOCAL ?? '';

const baseClient = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const documentClient = DynamoDBDocumentClient.from(baseClient);

async function createTable(): Promise<void> {
  await baseClient.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'gsi1pk', AttributeType: 'S' },
        { AttributeName: 'gsi1sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );
}

async function dropTable(): Promise<void> {
  try {
    await baseClient.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
  } catch {
    // ignore teardown failures — the table may not exist
  }
}

function waitForTable(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

/** Seeds a registered user row so the registry can resolve its name. */
async function seedUser(email: string, name: string): Promise<void> {
  const createdAt = new Date().toISOString();
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${email}`,
        SK: `USER#${email}`,
        gsi1pk: 'USER',
        gsi1sk: createdAt,
        email,
        name,
        position: 'Employee',
        createdAt,
      },
    })
  );
}

/** Builds a PENDING request aggregate with an explicit createdAt. */
function makeRequest(id: string, createdAt: string) {
  const draft = PurchaseRequest.validateDraft({
    title: `Request ${id}`,
    description: 'Work machine',
    amount: 1200.5,
    requesterEmail: 'ana@example.com',
    approverEmails: ['bob@example.com', 'carol@example.com', 'dave@example.com'],
  });
  return PurchaseRequest.assemble({
    id,
    createdAt,
    draft,
    requesterName: 'Ana',
    approverNames: ['Bob', 'Carol', 'Dave'],
  });
}

const APPROVERS = [
  { email: 'bob@example.com', name: 'Bob', token: 'token-bob' },
  { email: 'carol@example.com', name: 'Carol', token: 'token-carol' },
  { email: 'dave@example.com', name: 'Dave', token: 'token-dave' },
];

maybeDescribe('DynamoDbRequestRepository (integration)', () => {
  const repo = new DynamoDbRequestRepository({ tableName: TABLE_NAME, documentClient });
  const registry = new DynamoDbUserRegistry({ tableName: TABLE_NAME, documentClient });

  beforeAll(async () => {
    await createTable();
    await waitForTable();
    await seedUser('ana@example.com', 'Ana');
  });

  afterAll(async () => {
    await dropTable();
  });

  it('create writes a REQ row plus 3 APPR records and get assembles the detail', async () => {
    await repo.create(makeRequest('req-1', '2026-08-01T00:00:00.000Z'), APPROVERS);

    const detail = await repo.get('req-1');

    expect(detail).toBeDefined();
    expect(detail!.title).toBe('Request req-1');
    expect(detail!.status).toBe('PENDING');
    expect(detail!.createdBy).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(detail!.approvers).toHaveLength(3);
    expect(detail!.approvers.map((a) => a.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
    expect(detail!.approvers.map((a) => a.name).sort()).toEqual(['Bob', 'Carol', 'Dave']);
  });

  it('list returns requests newest first via GSI1', async () => {
    await repo.create(makeRequest('req-old', '2026-08-01T00:00:00.000Z'), APPROVERS);
    await repo.create(makeRequest('req-new', '2026-08-10T00:00:00.000Z'), APPROVERS);

    const summaries = await repo.list();

    const ids = summaries.map((s) => s.id);
    expect(ids[0]).toBe('req-new');
    expect(ids[1]).toBe('req-old');
  });

  it('get returns undefined for an unknown request id', async () => {
    await expect(repo.get('does-not-exist')).resolves.toBeUndefined();
  });

  it('registry resolves a seeded user and returns undefined for an unknown email', async () => {
    await expect(registry.findByEmail('ana@example.com')).resolves.toEqual({
      email: 'ana@example.com',
      name: 'Ana',
    });
    await expect(registry.findByEmail('ghost@example.com')).resolves.toBeUndefined();
  });
});