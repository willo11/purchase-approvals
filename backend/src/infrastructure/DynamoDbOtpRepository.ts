import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { OtpRepository, StoredOtp } from '../application/ports/OtpRepository';

/**
 * OTP item key (design-concurrency §1): PK/SK = `OTP#<requestId>#<email>`.
 * The email separator keeps the natural key unique per request+approver.
 */
function otpKey(requestId: string, email: string): string {
  return `OTP#${requestId}#${email}`;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

export interface OtpRepositoryEnv {
  tableName: string;
  documentClient: DynamoDBDocumentClient;
}

/**
 * DynamoDB adapter for the {@link OtpRepository} port.
 *
 * Stores the OTP digest in its OWN TTL item (`OTP#<reqId>#<email>`) with the
 * table TTL attribute `otpExpiresAt` set to the in-code expiry (3 min), so
 * DynamoDB deletes expired OTPs as cleanup while the DURABLE approver record
 * is never touched (spec R3/R4, design-concurrency §1/§6, Decision 4).
 * Consumption is a conditional compare-and-swap DELETE so one-time use holds
 * under concurrency (spec R4).
 */
export class DynamoDbOtpRepository implements OtpRepository {
  constructor(private readonly env: OtpRepositoryEnv) {}

  async putOtp(
    requestId: string,
    email: string,
    otpHash: string,
    otpExpiresAtEpochSeconds: number
  ): Promise<void> {
    const key = otpKey(requestId, email);
    await this.env.documentClient.send(
      new PutCommand({
        TableName: this.env.tableName,
        Item: {
          PK: key,
          SK: key,
          otpHash,
          otpExpiresAt: otpExpiresAtEpochSeconds, // table TTL attribute (cleanup)
        },
      })
    );
  }

  async getOtp(requestId: string, email: string): Promise<StoredOtp | undefined> {
    const key = otpKey(requestId, email);
    const result = await this.env.documentClient.send(
      new GetCommand({
        TableName: this.env.tableName,
        Key: { PK: key, SK: key },
      })
    );
    const item = result.Item;
    if (!item) return undefined;
    return { otpHash: String(item.otpHash), otpExpiresAt: Number(item.otpExpiresAt) };
  }

  async consumeOtp(
    requestId: string,
    email: string,
    expectedHash: string,
    nowEpochSeconds: number
  ): Promise<boolean> {
    const key = otpKey(requestId, email);
    try {
      // Compare-and-swap DELETE: succeeds only while the item still holds
      // `expectedHash` and is unexpired. A concurrent identical submit after
      // this item is gone (or on a mismatched/expired OTP) fails the condition,
      // so only ONE submission can ever consume → one-time use (spec R4).
      await this.env.documentClient.send(
        new DeleteCommand({
          TableName: this.env.tableName,
          Key: { PK: key, SK: key },
          ConditionExpression: 'otpHash = :expectedHash AND otpExpiresAt > :now',
          ExpressionAttributeValues: {
            ':expectedHash': expectedHash,
            ':now': nowEpochSeconds,
          },
        })
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false; // already consumed / not ours
      throw err;
    }
  }
}

/**
 * Builds the standard DynamoDB-backed OTP repository wired to the environment
 * (same local-env pattern as the other repositories).
 */
export function makeOtpRepository(): DynamoDbOtpRepository {
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
  return new DynamoDbOtpRepository({ tableName, documentClient: client });
}