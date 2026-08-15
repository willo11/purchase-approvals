#!/usr/bin/env node
/**
 * Creates the local single-table for development (dynamodb-local at :8000).
 *
 * This REPLICATES the schema declared in serverless.yml (resources →
 * PurchaseApprovalsTable) so you never need the AWS CLI locally. `serverless
 * offline` does NOT provision CloudFormation resources, and the dynamodb-local
 * container runs in-memory (this compose has no -dbPath/volume), so the table
 * is re-created after each `pnpm -C backend run db:up`.
 *
 * Idempotent: if the table already exists it logs a friendly OK and exits 0.
 *
 * Usage:
 *   pnpm -C backend run db:up          # start dynamodb-local (needs Docker)
 *   pnpm -C backend run db:create-table
 *
 * Reads backend/.env via `node --env-file` (DYNAMODB_LOCAL, TABLE_NAME).
 */
import {
  DynamoDBClient,
  CreateTableCommand,
} from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DYNAMODB_LOCAL ?? 'http://localhost:8000';
const tableName = process.env.TABLE_NAME ?? 'purchase-approvals-dev';
const region = process.env.AWS_REGION ?? 'us-east-1';

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

try {
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
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
      TimeToLiveSpecification: {
        AttributeName: 'otpExpiresAt',
        Enabled: true,
      },
    })
  );
  console.log(`✓ Local table "${tableName}" created at ${endpoint}`);
} catch (err) {
  if (err.name === 'ResourceInUseException') {
    console.log(`✓ OK: table "${tableName}" already exists at ${endpoint}`);
  } else {
    console.error('✗ Error creating table:', err);
    process.exitCode = 1;
  }
}