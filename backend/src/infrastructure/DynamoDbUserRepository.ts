import {
  DynamoDBClient,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { User } from '../domain/User';
import { UserAlreadyExistsError } from '../domain/errors';
import { UserRepository } from '../application/ports/UserRepository';

/**
 * Type code used as the `gsi1pk` discriminator for USER rows. `gsi1sk` holds
 * the `createdAt` ISO string so listing users by GSI1 returns creation order
 * (design-concurrency.md §1, GSI1 = TYPE#<typecode> / createdAt).
 */
const TYPE_CODE = 'USER';

export interface UserRepositoryEnv {
  tableName: string;
  documentClient: DynamoDBDocumentClient;
}

/**
 * DynamoDB adapter for the {@link UserRepository} port.
 *
 * Single-table conventions (design-concurrency.md §1):
 *   PK = `USER#<email>`, SK = `USER#<email>`
 *   gsi1pk = `USER`, gsi1sk = createdAt (ISO)  → list by creation order.
 *
 * Duplicate prevention (spec R1): `save` issues a conditional `PutItem` with
 * `ConditionExpression: attribute_not_exists(PK)`. A `ConditionalCheckFailed`
 * from DynamoDB proves the email already exists and is forwarded to the
 * application as {@link UserAlreadyExistsError} — the port contract
 * "no overwrite" is enforced by the database, atomically.
 */
export class DynamoDbUserRepository implements UserRepository {
  constructor(private readonly env: UserRepositoryEnv) {}

  async save(user: User): Promise<void> {
    const primitives = user.toPrimitives();
    const email = primitives.email;
    const createdAt = new Date().toISOString();

    const item = {
      PK: `USER#${email}`,
      SK: `USER#${email}`,
      gsi1pk: TYPE_CODE,
      gsi1sk: createdAt,
      name: primitives.name,
      email,
      cargo: primitives.cargo,
      createdAt,
    };

    try {
      await this.env.documentClient.send(
        new PutCommand({
          TableName: this.env.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new UserAlreadyExistsError(
          `User with email ${email} is already registered`
        );
      }
      throw err;
    }
  }

  async listAll(): Promise<User[]> {
    const result = await this.env.documentClient.send(
      new QueryCommand({
        TableName: this.env.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :type',
        ExpressionAttributeValues: { ':type': TYPE_CODE },
        ScanIndexForward: true,
      })
    );

    const items =
      result.Items?.map((item) =>
        User.create({
          name: item.name,
          email: item.email,
          cargo: item.cargo ?? undefined,
        })
      ) ?? [];
    return items;
  }
}

/**
 * Builds the standard DynamoDB-backed repository wired to the environment.
 *
 * Local development (serverless-offline / integration tests) sets
 * `DYNAMODB_LOCAL`; when present we point the client at that endpoint with
 * dummy credentials (the same pattern as the PR #0 integration harness).
 */
export function makeUserRepository(): DynamoDbUserRepository {
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
  return new DynamoDbUserRepository({ tableName, documentClient: client });
}