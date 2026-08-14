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

  async deleteOtp(requestId: string, email: string): Promise<void> {
    const key = otpKey(requestId, email);
    await this.env.documentClient.send(
      new DeleteCommand({
        TableName: this.env.tableName,
        Key: { PK: key, SK: key },
      })
    );
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