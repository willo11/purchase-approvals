import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { MockMailRepo } from '../../src/infrastructure/MockMailRepo';
import type { MailEvent } from '../../src/application/ports/MailPort';

/**
 * Integration tests (demo-fixes) — real DynamoDB round-trips against
 * dynamodb-local for the mock-mail inbox: the optional `?to=<email>` filter
 * restricts the log to one recipient, newest first, while the no-param call
 * returns the FULL log.
 *
 * Gated by `DYNAMODB_LOCAL`. Creates its own disposable single-table
 * (PK/SK + GSI1), mirroring serverless.yml.
 */
const maybeDescribe = process.env.DYNAMODB_LOCAL ? describe : describe.skip;

const TABLE_NAME = 'purchase-approvals-mockmail-integration';
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
    // already gone — teardown must not fail the suite
  }
}

maybeDescribe('GET /mock-mail ?to= filter (dynamodb-local)', () => {
  let repo: MockMailRepo;

  beforeAll(async () => {
    await dropTable();
    await createTable();
    repo = new MockMailRepo({
      tableName: TABLE_NAME,
      documentClient,
    });
  });

  afterAll(async () => {
    await dropTable();
  });

  async function sendAll() {
    const events: MailEvent[] = [
      {
        id: 'mail-bob-new',
        to: 'bob@example.com',
        type: 'OTP',
        subject: 'Your code',
        body: 'Code: 123456',
        otpPlain: '123456',
        createdAt: '2026-08-14T00:03:00.000Z',
      },
      {
        id: 'mail-carol',
        to: 'carol@example.com',
        type: 'APPROVAL_LINK',
        subject: 'Approval needed',
        body: 'Please approve.',
        link: 'https://host/approve?request_id=req-1&approver_token=carol-token',
        createdAt: '2026-08-14T00:02:00.000Z',
      },
      {
        id: 'mail-bob-old',
        to: 'bob@example.com',
        type: 'APPROVAL_LINK',
        subject: 'Approval needed',
        body: 'Please approve.',
        link: 'https://host/approve?request_id=req-1&approver_token=bob-token',
        createdAt: '2026-08-14T00:01:00.000Z',
      },
    ];
    for (const event of events) {
      await repo.send(event);
    }
  }

  it('no param returns ALL mails, newest first', async () => {
    await sendAll();

    const events = await repo.list();

    expect(events.map((e) => e.id)).toEqual([
      'mail-bob-new',
      'mail-carol',
      'mail-bob-old',
    ]);
  });

  it('?to=<email> returns only that recipient, newest first', async () => {
    const events = await repo.list('bob@example.com');

    expect(events.map((e) => e.id)).toEqual(['mail-bob-new', 'mail-bob-old']);
    expect(events.every((e) => e.to === 'bob@example.com')).toBe(true);
  });

  it('?to=<email> with no mails for that recipient returns []', async () => {
    const events = await repo.list('ghost@example.com');

    expect(events).toEqual([]);
  });
});