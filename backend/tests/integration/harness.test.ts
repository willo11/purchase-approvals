import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';

/**
 * Integration harness smoke test (task 0.4).
 *
 * Gated by `DYNAMODB_LOCAL` (e.g. `http://localhost:8000`). Skipped by default
 * so `npm test` runs without Docker; run `npm run test:integration` (which sets
 * the env var) after `npm run db:up` to prove the AWS SDK v3 client can reach
 * the dockerized DynamoDB. Real repository round-trips land with PRs #1-#5.
 */
// `@types/jest` does not type `describe.skipIf`; the conditional assignment
// gives the same skip-when-unset behavior.
const maybeDescribe = process.env.DYNAMODB_LOCAL ? describe : describe.skip;

maybeDescribe('dynamodb-local harness', () => {
  it('reaches the local DynamoDB endpoint', async () => {
    const client = new DynamoDBClient({
      endpoint: process.env.DYNAMODB_LOCAL,
      region: 'us-east-1',
      // Local DynamoDB does not authenticate; dummy credentials satisfy the
      // SDK v3 credential chain (never used outside the local endpoint).
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    });

    const { TableNames } = await client.send(new ListTablesCommand({}));
    expect(TableNames).toBeDefined();
  });
});
