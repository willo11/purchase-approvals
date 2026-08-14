import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
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
 * `create` issues one PutItem for the REQ row and one per approver record —
 * the same put-per-row style as DynamoDbUserRepository. `list` queries GSI1
 * newest-first; `get` reads the REQ row then queries its approver set and
 * derives their status from the persisted signature timestamps.
 */
export class DynamoDbRequestRepository implements RequestRepository {
  constructor(private readonly env: RequestRepositoryEnv) {}

  async create(request: PurchaseRequest, approvers: ApproverStorageRecord[]): Promise<void> {
    const detail = request.toDetail();

    await this.env.documentClient.send(
      new PutCommand({
        TableName: this.env.tableName,
        Item: {
          PK: `REQ#${request.getId()}`,
          SK: `REQ#${request.getId()}`,
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
      })
    );

    for (const approver of approvers) {
      await this.env.documentClient.send(
        new PutCommand({
          TableName: this.env.tableName,
          Item: {
            PK: `REQ#${request.getId()}`,
            SK: `${APPR_PREFIX}${approver.email}`,
            email: approver.email,
            name: approver.name,
            token: approver.token,
            tokenStatus: 'ACTIVE',
            attempts: 0,
          },
        })
      );
    }
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
      })
    );

    return this.toDetail(id, reqItem, approverResult.Items ?? []);
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