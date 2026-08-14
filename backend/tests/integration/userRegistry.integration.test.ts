import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbUserRepository } from '../../src/infrastructure/DynamoDbUserRepository';
import { User } from '../../src/domain/User';
import { UserAlreadyExistsError } from '../../src/domain/errors';

/**
 * Integration test (task 1.7) — real DynamoDB round-trip against dynamodb-local.
 *
 * Gated by `DYNAMODB_LOCAL` (e.g. http://localhost:8000). Skipped by default;
 * run `pnpm -C backend run db:up` then `pnpm -C backend run test:integration`.
 * The suite creates its own table (single-table PK/SK + GSI1), proves register
 * + duplicate-prevention + ordered list, then drops it.
 */
const maybeDescribe = process.env.DYNAMODB_LOCAL ? describe : describe.skip;

const TABLE_NAME = 'purchase-approvals-userregistry-integration';
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

maybeDescribe('DynamoDbUserRepository (integration)', () => {
  const repo = new DynamoDbUserRepository({ tableName: TABLE_NAME, documentClient });
  const unique = Date.now();

  beforeAll(async () => {
    await createTable();
    await waitForTable();
  });

  afterAll(async () => {
    await dropTable();
  });

  it('registers a user and persists it under the email key', async () => {
    const email = `ana${unique}@example.com`;
    const user = User.create({ name: 'Ana', email, position: 'Accountant' });

    await repo.save(user);

    const listed = await repo.listAll();
    const found = listed.find((u) => u.getEmail().toString() === email);
    expect(found).toBeDefined();
    expect(found?.toPrimitives()).toEqual({ name: 'Ana', email, position: 'Accountant' });
  });

  it('rejects a duplicate email and does not overwrite', async () => {
    const email = `dup${unique}@example.com`;
    const original = User.create({ name: 'Original', email, position: 'Analyst' });
    await repo.save(original);

    const dupe = User.create({ name: 'Duplicate', email, position: 'Other Position' });
    await expect(repo.save(dupe)).rejects.toThrow(UserAlreadyExistsError);

    const listed = await repo.listAll();
    const found = listed.find((u) => u.getEmail().toString() === email);
    expect(found?.toPrimitives()).toEqual({ name: 'Original', email, position: 'Analyst' });
  });

  it('lists registered users in creation order', async () => {
    const first = `first${unique}@example.com`;
    const second = `second${unique}@example.com`;
    await repo.save(User.create({ name: 'First', email: first }));
    await repo.save(User.create({ name: 'Second', email: second }));

    const emails = (await repo.listAll()).map((u) => u.getEmail().toString());
    const firstIdx = emails.indexOf(first);
    const secondIdx = emails.indexOf(second);
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });
});