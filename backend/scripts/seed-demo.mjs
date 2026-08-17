// Demo seed — registers the 4 employees the walkthrough uses (1 requester + 3
// approvers) directly into the local DynamoDB table, mirroring the exact item
// shape of DynamoDbUserRepository (PK/SK = USER#<email>, gsi1pk = USER,
// gsi1sk = createdAt, name, email, position).
//
// Idempotent: a user that already exists is skipped (re-run is safe).
//
// Usage (local only, table must exist first):
//   pnpm -C backend run db:seed
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const DEMO_USERS = [
  { name: 'Ruth', email: 'ruth@example.com', position: 'Manager' },
  { name: 'Ana', email: 'ana@example.com', position: 'Analyst' },
  { name: 'Sven', email: 'sven@example.com', position: 'Director' },
  { name: 'Luca', email: 'luca@example.com', position: 'Compliance' },
];

const endpoint = process.env.DYNAMODB_LOCAL;
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: endpoint || undefined,
    ...(endpoint
      ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  })
);
const tableName = process.env.TABLE_NAME ?? 'purchase-approvals-dev';

let created = 0;
let skipped = 0;

for (const user of DEMO_USERS) {
  const createdAt = new Date().toISOString();
  const item = {
    PK: `USER#${user.email}`,
    SK: `USER#${user.email}`,
    gsi1pk: 'USER',
    gsi1sk: createdAt,
    name: user.name,
    email: user.email,
    position: user.position,
    createdAt,
  };
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
    created += 1;
    console.log(`✓ Created ${user.name} <${user.email}> (${user.position})`);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      skipped += 1;
      console.log(`· Skipped ${user.name} <${user.email}> — already exists`);
    } else {
      console.error(`✗ Failed ${user.name} <${user.email}>:`, err.message);
      process.exitCode = 1;
    }
  }
}

console.log(`\nSeed done: ${created} created, ${skipped} skipped on table "${tableName}".`);
if (created > 0) {
  console.log('Demo cast ready: ruth@example.com (requester), ana/sven/luca@example.com (approvers).');
}
