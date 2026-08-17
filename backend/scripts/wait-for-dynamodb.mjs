// Waits for the local DynamoDB endpoint to accept requests (readiness poll).
//
// `docker compose up -d` returns as soon as the container starts; the Java
// dynamodb-local process takes a moment to open port 8000. A command chained
// right after db:up (e.g. db:create-table) races the container and fails with
// ECONNRESET/TimeoutError on a cold start. Instead of a blind sleep this
// script polls ListTables against the endpoint every 500ms (up to 30s) and
// exits 0 as soon as DynamoDB answers.
//
// Usage (wired as backend `db:wait`, runs with --env-file=.env):
//   pnpm -C backend run db:wait
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DYNAMODB_LOCAL;
const MAX_ATTEMPTS = 60; // 60 x 500ms = 30s
const POLL_MS = 500;

if (!endpoint) {
  console.error('[wait-for-dynamodb] DYNAMODB_LOCAL is not set — refusing to wait.');
  process.exit(1);
}

const client = new DynamoDBClient({
  endpoint,
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    await client.send(new ListTablesCommand({}));
    console.log(`[wait-for-dynamodb] DynamoDB ready at ${endpoint} (attempt ${attempt}).`);
    process.exit(0);
  } catch {
    if (attempt === MAX_ATTEMPTS) {
      console.error(
        `[wait-for-dynamodb] DynamoDB did not answer at ${endpoint} after 30s. ` +
          'Check that `pnpm -C backend run db:up` started the container.'
      );
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}