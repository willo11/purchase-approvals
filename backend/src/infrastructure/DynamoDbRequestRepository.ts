import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  PurchaseRequest,
  RequestDetail,
  RequestSummary,
} from '../domain/PurchaseRequest';
import { Approver } from '../domain/Approver';
import {
  RequestRepository,
  ApproverStorageRecord,
} from '../application/ports/RequestRepository';

/**
 * Type code used as the `gsi1pk` discriminator for REQ rows. `gsi1sk` holds
 * the `createdAt` ISO string; listing by GSI1 with `ScanIndexForward: false`
 * returns requests newest first (design-concurrency.md §1, design R3).
 */
const TYPE_CODE = 'REQ';
const APPR_PREFIX = 'APPR#';

function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

export interface RequestRepositoryEnv {
  tableName: string;
  documentClient: DynamoDBDocumentClient;
}

/**
 * DynamoDB adapter for the {@link RequestRepository} port.
 *
 * Single-table conventions (design-concurrency.md §1):
 *   REQ  → PK=`REQ#<id>`, SK=`REQ#<id>`, gsi1pk=REQ, gsi1sk=createdAt
 *   APPR → PK=`REQ#<id>`, SK=`APPR#<email>`
 *
 * `create` writes the REQ row plus all 3 approver records in a SINGLE
 * `TransactWriteItems` (all-or-nothing), so a mid-write failure cannot leave a
 * partial request. `list` queries GSI1 newest-first; `get` reads the REQ row
 * then queries its approver set and derives their status from the persisted
 * signature timestamps.
 */
export class DynamoDbRequestRepository implements RequestRepository {
  constructor(private readonly env: RequestRepositoryEnv) {}

  async create(request: PurchaseRequest, approvers: ApproverStorageRecord[]): Promise<void> {
    const detail = request.toDetail();
    const requestId = request.getId();

    // ONE transaction writes the REQ row + all 3 approver rows all-or-nothing.
    // A mid-write failure therefore can never leave a partial request (e.g. a
    // REQ without its approver set) — the durable creation is atomic.
    const transactItems = [
      {
        Put: {
          TableName: this.env.tableName,
          Item: {
            PK: `REQ#${requestId}`,
            SK: `REQ#${requestId}`,
            gsi1pk: TYPE_CODE,
            gsi1sk: detail.createdAt,
            id: detail.id,
            title: detail.title,
            description: detail.description,
            amount: detail.amount,
            currency: detail.currency,
            status: detail.status,
            createdBy: detail.createdBy,
            approvers: detail.approvers.map((a) => ({ email: a.email, name: a.name })),
            createdAt: detail.createdAt,
          },
        },
      },
      ...approvers.map((approver) => ({
        Put: {
          TableName: this.env.tableName,
          Item: {
            PK: `REQ#${requestId}`,
            SK: `${APPR_PREFIX}${approver.email}`,
            email: approver.email,
            name: approver.name,
            token: approver.token,
            tokenStatus: 'ACTIVE',
            attempts: 0,
          },
        },
      })),
    ];

    await this.env.documentClient.send(
      new TransactWriteCommand({ TransactItems: transactItems })
    );
  }

  async list(): Promise<RequestSummary[]> {
    const result = await this.env.documentClient.send(
      new QueryCommand({
        TableName: this.env.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :type',
        ExpressionAttributeValues: { ':type': TYPE_CODE },
        ScanIndexForward: false, // newest first
      })
    );
    return (result.Items ?? []).map((item) => this.toSummary(item));
  }

  async get(id: string): Promise<RequestDetail | undefined> {
    const reqResult = await this.env.documentClient.send(
      new GetCommand({
        TableName: this.env.tableName,
        Key: { PK: `REQ#${id}`, SK: `REQ#${id}` },
        // Strongly consistent read (fresh-review FIX 2): the REQ row carries
        // the completion state AND the evidenceKey, so an eventually-consistent
        // read could transiently hide a just-committed `COMPLETED`/`evidenceKey`
        // — a download right after the 3rd approval could 404, and the
        // pre-generation evidenceKey guard could see stale state. Same liveness
        // rationale as the ConsistentRead on the approver-set query below.
        ConsistentRead: true,
      })
    );
    const reqItem = reqResult.Item;
    if (!reqItem) return undefined;

    const approverResult = await this.env.documentClient.send(
      new QueryCommand({
        TableName: this.env.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :appr)',
        ExpressionAttributeValues: {
          ':pk': `REQ#${id}`,
          ':appr': APPR_PREFIX,
        },
        // Strongly consistent read of the approver set: two concurrent signers
        // must each observe the OTHER's committed Step A write, or neither
        // would reach the completion CAS and the request would stick PENDING
        // forever (fresh-review FIX 2). A stale eventually-consistent read can
        // only ever under-count signed approvers.
        ConsistentRead: true,
      })
    );

    return this.toDetail(id, reqItem, approverResult.Items ?? []);
  }

  async completeIfAbsent(id: string, completedAt: string): Promise<boolean> {
    try {
      await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${id}`, SK: `REQ#${id}` },
          // `status` is a reserved DynamoDB keyword → #status placeholder.
          UpdateExpression: 'SET completedAt = :now, #status = :completed, gsi1sk = :now',
          // Step B completion CAS (design-concurrency §3): only ONE writer can
          // pass. Symmetric with the reject CAS: `#status = :pending` makes the
          // completion lose to a concurrent reject that already set REJECTED
          // (cross-direction single winner — a REJECTED request can never be
          // flipped back to COMPLETED, so `completedAt`/`rejectedAt` never
          // coexist).
          ConditionExpression: 'attribute_not_exists(completedAt) AND #status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':now': completedAt,
            ':completed': 'COMPLETED',
            ':pending': 'PENDING',
          },
        })
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  async rejectIfPending(
    id: string,
    rejectorEmail: string,
    rejectedAt: string
  ): Promise<boolean> {
    try {
      await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${id}`, SK: `REQ#${id}` },
          // `status` is a reserved DynamoDB keyword → #status placeholder.
          UpdateExpression:
            'SET rejectedAt = :now, rejectedBy = :who, #status = :rejected, gsi1sk = :now',
          // Step B reject CAS (design-concurrency §4): only the FIRST reject (and
          // a still-PENDING state) can pass; an already-COMPLETED request fails.
          // `status` is a reserved DynamoDB keyword → #status placeholder in the
          // condition AND the update.
          ConditionExpression: '#status = :pending AND attribute_not_exists(rejectedAt)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':now': rejectedAt,
            ':who': rejectorEmail,
            ':rejected': 'REJECTED',
            ':pending': 'PENDING',
          },
        })
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  async recordEvidence(id: string, evidenceKey: string): Promise<boolean> {
    try {
      await this.env.documentClient.send(
        new UpdateCommand({
          TableName: this.env.tableName,
          Key: { PK: `REQ#${id}`, SK: `REQ#${id}` },
          UpdateExpression: 'SET evidenceKey = :key',
          // Evidence idempotency guard (design-concurrency §5): the key is set
          // at most once. A replay that already recorded it is a no-op, so a
          // redelivered/double execution can never double-set.
          ConditionExpression: 'attribute_not_exists(evidenceKey)',
          ExpressionAttributeValues: { ':key': evidenceKey },
        })
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  private toSummary(item: Record<string, unknown>): RequestSummary {
    return {
      id: String(item.id),
      title: String(item.title),
      amount: Number(item.amount),
      currency: String(item.currency),
      status: item.status as RequestSummary['status'],
      createdAt: String(item.createdAt),
    };
  }

  private toDetail(
    id: string,
    reqItem: Record<string, unknown>,
    approverItems: Record<string, unknown>[]
  ): RequestDetail {
    const approvers = approverItems.map((row) =>
      Approver.fromSnapshot({
        email: String(row.email),
        name: String(row.name),
        status_signed: row.status_signed as string | undefined,
        status_rejected: row.status_rejected as string | undefined,
      }).toView()
    );
    const createdBy = (reqItem.createdBy ?? { email: '', name: '' }) as {
      email: string;
      name: string;
    };
    return {
      id,
      title: String(reqItem.title),
      description: String(reqItem.description),
      amount: Number(reqItem.amount),
      currency: String(reqItem.currency),
      status: reqItem.status as RequestDetail['status'],
      createdBy: { email: createdBy.email, name: createdBy.name },
      approvers,
      createdAt: String(reqItem.createdAt),
      // Evidence key present only after a successful generation (spec R2/R4).
      ...(reqItem.evidenceKey ? { evidenceKey: String(reqItem.evidenceKey) } : {}),
    };
  }
}

/**
 * Builds the standard DynamoDB-backed repository wired to the environment.
 * Local development / integration tests set `DYNAMODB_LOCAL` (same pattern as
 * makeUserRepository in PR #1).
 */
export function makeRequestRepository(): DynamoDbRequestRepository {
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
  return new DynamoDbRequestRepository({ tableName, documentClient: client });
}