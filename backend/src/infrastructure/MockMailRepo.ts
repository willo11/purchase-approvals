import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { MailEvent, MailLog } from '../application/ports/MailPort';

/**
 * Type code used as the `gsi1pk` discriminator for MAIL rows. `gsi1sk` holds
 * the `createdAt` ISO string; listing by GSI1 with `ScanIndexForward: false`
 * returns sent mail newest first (design-concurrency §1, spec R2).
 */
const TYPE_CODE = 'MAIL';

export interface MockMailRepoEnv {
  tableName: string;
  documentClient: DynamoDBDocumentClient;
}

/**
 * DynamoDB adapter for the {@link MailLog} port — the simulated inbox.
 *
 * Every `send()` writes a `MAIL#<uuid>` row (PK/SK=MAIL#<uuid>, gsi1pk=MAIL,
 * gsi1sk=createdAt) in the single table. `list()` queries GSI1 newest first
 * and rehydrates the exact {@link MailEvent} shapes, so `GET /mock-mail` shows
 * approval-link mails AND OTP mails with their demo-disclosed plain code.
 */
export class MockMailRepo implements MailLog {
  constructor(private readonly env: MockMailRepoEnv) {}

  async send(event: MailEvent): Promise<void> {
    await this.env.documentClient.send(
      new PutCommand({
        TableName: this.env.tableName,
        Item: {
          PK: `MAIL#${event.id}`,
          SK: `MAIL#${event.id}`,
          gsi1pk: TYPE_CODE,
          gsi1sk: event.createdAt,
          id: event.id,
          to: event.to,
          type: event.type,
          subject: event.subject,
          body: event.body,
          ...(event.link ? { link: event.link } : {}),
          ...(event.otpPlain !== undefined ? { otpPlain: event.otpPlain } : {}),
          createdAt: event.createdAt,
        },
      })
    );
  }

  async list(): Promise<MailEvent[]> {
    const result = await this.env.documentClient.send(
      new QueryCommand({
        TableName: this.env.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :type',
        ExpressionAttributeValues: { ':type': TYPE_CODE },
        ScanIndexForward: false, // newest first
      })
    );
    return (result.Items ?? []).map((item) => this.toEvent(item));
  }

  private toEvent(item: Record<string, unknown>): MailEvent {
    const event: MailEvent = {
      id: String(item.id),
      to: String(item.to),
      type: item.type as MailEvent['type'],
      subject: String(item.subject),
      body: String(item.body),
      createdAt: String(item.createdAt),
    };
    if (item.link !== undefined) event.link = String(item.link);
    if (item.otpPlain !== undefined) event.otpPlain = String(item.otpPlain);
    return event;
  }
}

/**
 * Builds the standard DynamoDB-backed mock mail repo wired to the environment
 * (same local-env pattern as makeUserRegistry / makeRequestRepository).
 */
export function makeMockMailRepo(): MockMailRepo {
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
  return new MockMailRepo({ tableName, documentClient: client });
}