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
 * (design-concurrency §1/§6). Attempts are incremented under a conditional
 * CAS (`attempts < limitMinusOne` AND token still `ACTIVE`) so concurrent wrong
 * submissions can never overshoot the counter, and the counter NEVER reaches
 * the limit while the token is still `ACTIVE`: reaching the limit and setting
 * `INVALIDATED_LOCKOUT` happen in a SINGLE atomic conditional update, so there
 * is no window where a token is live with the counter exhausted.
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
    // COMMON PATH (failures 1 and 2): increment attempts while the counter is
    // BELOW `limitMinusOne`, so attempts can never reach 3 here — the value 3
    // is only ever written together with the lockout (next block). If the
    // counter is already at `limitMinusOne` (i.e. the 3rd failure), or another
    // writer beat us, the condition fails and we fall through to the atomic
    // lockout transition.
    try {
      const result = (await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${requestId}`, SK: `${APPR_PREFIX}${email}` },
          UpdateExpression: 'SET attempts = attempts + :one',
          ConditionExpression:
            'tokenStatus = :active AND attempts < :limitMinusOne AND attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)',
          ExpressionAttributeValues: {
            ':one': 1,
            ':active': 'ACTIVE',
            ':limitMinusOne': OTP_LOCKOUT_LIMIT - 1,
          },
          ReturnValues: 'ALL_NEW',
        })
      )) as { Attributes?: Record<string, unknown> };
      return { attempts: Number(result.Attributes?.attempts ?? 0), lockedOut: false };
    } catch (err) {
      if (!isConditionalCheckFailed(err)) throw err;
    }

    // LOCKOUT TRANSITION (the 3rd failure): ONE atomic conditional update sets
    // attempts = attempts + 1 (2 → 3) AND tokenStatus = INVALIDATED_LOCKOUT
    // together, guarded by `attempts = :limitMinusOne`. Only the single writer
    // that observed attempts == 2 can win; a concurrent rival gets
    // ConditionalCheckFailed and is treated as already locked. There is NO
    // instant where attempts == 3 while the token is still ACTIVE. The token
    // can never exceed the limit (no overshoot).
    try {
      await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${requestId}`, SK: `${APPR_PREFIX}${email}` },
          UpdateExpression: 'SET attempts = attempts + :one, tokenStatus = :locked',
          ConditionExpression:
            'tokenStatus = :active AND attempts = :limitMinusOne AND attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)',
          ExpressionAttributeValues: {
            ':one': 1,
            ':locked': 'INVALIDATED_LOCKOUT',
            ':active': 'ACTIVE',
            ':limitMinusOne': OTP_LOCKOUT_LIMIT - 1,
          },
        })
      );
      return { attempts: OTP_LOCKOUT_LIMIT, lockedOut: true };
    } catch (err) {
      // Another writer already reached the counter limit and transitioned to
      // lockout (or the token is no longer ACTIVE): treat as locked.
      if (isConditionalCheckFailed(err)) {
        return { attempts: OTP_LOCKOUT_LIMIT, lockedOut: true };
      }
      throw err;
    }
  }

  async markSigned(
    requestId: string,
    email: string,
    signature: { name: string; timestamp: string }
  ): Promise<boolean> {
    try {
      await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${requestId}`, SK: `${APPR_PREFIX}${email}` },
          UpdateExpression: 'SET status_signed = :now, signature = :sig',
          // Step A approve CAS (design-concurrency §3): per-approver idempotency.
          ConditionExpression:
            'attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)',
          ExpressionAttributeValues: { ':now': signature.timestamp, ':sig': signature },
        })
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  async markRejected(
    requestId: string,
    email: string,
    signature: { name: string; timestamp: string }
  ): Promise<boolean> {
    try {
      await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${requestId}`, SK: `${APPR_PREFIX}${email}` },
          UpdateExpression: 'SET status_rejected = :now, signature = :sig',
          // Step A reject CAS (design-concurrency §4).
          ConditionExpression:
            'attribute_not_exists(status_signed) AND attribute_not_exists(status_rejected)',
          ExpressionAttributeValues: { ':now': signature.timestamp, ':sig': signature },
        })
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
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