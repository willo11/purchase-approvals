import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { OTP_LOCKOUT_LIMIT } from '../domain/services/otpConstants';
import {
  ApproverRepository,
  ApproverGateState,
  AttemptIncrement,
} from '../application/ports/ApproverRepository';

/**
 * Type code / sort prefix for the durable approver rows of a request
 * (design-concurrency §1: PK=`REQ#<id>`, SK=`APPR#<email>`).
 */
const APPR_PREFIX = 'APPR#';

export interface ApproverRepositoryEnv {
  tableName: string;
  documentClient: DynamoDBDocumentClient;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

/**
 * DynamoDB adapter for the {@link ApproverRepository} port.
 *
 * The lockout state lives on the DURABLE approver item (`APPR#<email>`), never
 * on the OTP TTL item, so table TTL cleanup never deletes approval/status data
 * (design-concurrency §1/§6). Failed-attempt increments are conditional
 * compare-and-swap (`attempts < 3` AND token still `ACTIVE`), so concurrent
 * wrong submissions cannot overshoot the counter; when the counter reaches the
 * limit the token is durably set to `INVALIDATED_LOCKOUT`.
 */
export class DynamoDbApproverRepository implements ApproverRepository {
  constructor(private readonly env: ApproverRepositoryEnv) {}

  async findByToken(requestId: string, token: string): Promise<ApproverGateState | undefined> {
    const result = await this.env.documentClient.send(
      new QueryCommand({
        TableName: this.env.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `REQ#${requestId}`,
          ':prefix': APPR_PREFIX,
        },
      })
    );
    const item = (result.Items ?? []).find((row) => String(row.token) === token);
    if (!item) return undefined;
    return this.toGateState(item);
  }

  async incrementAttempts(requestId: string, email: string): Promise<AttemptIncrement> {
    let result: { Attributes?: Record<string, unknown> };
    try {
      result = (await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${requestId}`, SK: `${APPR_PREFIX}${email}` },
          UpdateExpression: 'SET attempts = attempts + :one',
          ConditionExpression:
            'tokenStatus = :active AND attempts < :limit AND attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)',
          ExpressionAttributeValues: {
            ':one': 1,
            ':active': 'ACTIVE',
            ':limit': OTP_LOCKOUT_LIMIT,
          },
          ReturnValues: 'ALL_NEW',
        })
      )) as { Attributes?: Record<string, unknown> };
    } catch (err) {
      // The conditional write failed (already locked / already acted): treat as
      // locked so the gate can no longer proceed.
      if (isConditionalCheckFailed(err)) {
        return { attempts: OTP_LOCKOUT_LIMIT, lockedOut: true };
      }
      throw err;
    }

    const attempts = Number(result.Attributes?.attempts ?? 0);
    if (attempts >= OTP_LOCKOUT_LIMIT) {
      // Durable, idempotent lockout: only the write that reached the limit wins
      // the transition; a second attempt is a no-op because tokenStatus != ACTIVE.
      await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${requestId}`, SK: `${APPR_PREFIX}${email}` },
          UpdateExpression: 'SET tokenStatus = :locked',
          ConditionExpression: 'tokenStatus = :active',
          ExpressionAttributeValues: { ':locked': 'INVALIDATED_LOCKOUT', ':active': 'ACTIVE' },
        })
      );
      return { attempts, lockedOut: true };
    }
    return { attempts, lockedOut: false };
  }

  async resetAttemptsIfActive(requestId: string, email: string): Promise<boolean> {
    try {
      await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${requestId}`, SK: `${APPR_PREFIX}${email}` },
          UpdateExpression: 'SET attempts = :zero',
          ConditionExpression: 'tokenStatus = :active',
          ExpressionAttributeValues: { ':zero': 0, ':active': 'ACTIVE' },
        })
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  private toGateState(item: Record<string, unknown>): ApproverGateState {
    const state: ApproverGateState = {
      email: String(item.email),
      name: String(item.name),
      token: String(item.token),
      tokenStatus: (item.tokenStatus as ApproverGateState['tokenStatus']) ?? 'ACTIVE',
      attempts: Number(item.attempts ?? 0),
    };
    if (item.status_signed !== undefined) state.status_signed = String(item.status_signed);
    if (item.status_rejected !== undefined) state.status_rejected = String(item.status_rejected);
    return state;
  }
}

/**
 * Builds the standard DynamoDB-backed approver repository wired to the
 * environment (same local-env pattern as the other repositories).
 */
export function makeApproverRepository(): DynamoDbApproverRepository {
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
  return new DynamoDbApproverRepository({ tableName, documentClient: client });
}