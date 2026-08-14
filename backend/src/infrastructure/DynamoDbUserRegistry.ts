import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  RegistryUser,
  UserRegistryPort,
} from '../application/ports/UserRegistryPort';

export interface UserRegistryEnv {
  tableName: string;
  documentClient: DynamoDBDocumentClient;
}

/**
 * DynamoDB-backed read view over the user registry.
 *
 * Resolves an email to its registered name via single-item `GetItem` on
 * `USER#<email>` (design-concurrency.md §1). It never mutates users — the
 * purchase-request core only reads them to snapshot names (design R1).
 */
export class DynamoDbUserRegistry implements UserRegistryPort {
  constructor(private readonly env: UserRegistryEnv) {}

  async findByEmail(email: string): Promise<RegistryUser | undefined> {
    const result = await this.env.documentClient.send(
      new GetCommand({
        TableName: this.env.tableName,
        Key: { PK: `USER#${email}`, SK: `USER#${email}` },
      })
    );
    const item = result.Item;
    if (!item) return undefined;
    return { email: String(item.email), name: String(item.name) };
  }
}

/**
 * Builds the standard DynamoDB-backed user registry wired to the environment
 * (same local-env pattern as makeUserRepository / makeRequestRepository).
 */
export function makeUserRegistry(): DynamoDbUserRegistry {
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
  return new DynamoDbUserRegistry({ tableName, documentClient: client });
}