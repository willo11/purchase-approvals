import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PDFDocument } from 'pdf-lib';
import { DynamoDbRequestRepository } from '../../src/infrastructure/DynamoDbRequestRepository';
import { DynamoDbApproverRepository } from '../../src/infrastructure/DynamoDbApproverRepository';
import { PdfGenerator } from '../../src/infrastructure/PdfGenerator';
import { ApproveRequest } from '../../src/application/ApproveRequest';
import { ApproverGate } from '../../src/application/ApproverGate';
import { PurchaseRequest } from '../../src/domain/PurchaseRequest';
import { buildDownload } from '../../src/api/handlers/evidence';
import type { EvidenceGeneratorPort } from '../../src/application/ports/EvidenceGeneratorPort';
import { FakeEvidenceStore } from '../unit/helpers/fakeEvidenceStore';

/**
 * End-to-end evidence flow against dynamodb-local (task 5.6, spec R1/R3/R4):
 *
 *   - 3rd approve triggers generation: the completion CAS winner stores a REAL
 *     PDF (PdfGenerator) in the IN-MEMORY evidence store (the S3 seam) and
 *     records `evidenceKey` on the REQ row (R2).
 *   - download GET returns the real PDF bytes with application/pdf (R3).
 *   - a non-completed request downloads 404 (R3).
 *   - a generation failure keeps `COMPLETED` with no evidenceKey and download
 *     404 until a successful generation exists (R4).
 *
 * Gated by `DYNAMODB_LOCAL`. Disposable single table mirroring serverless.yml.
 */
const maybeDescribe = process.env.DYNAMODB_LOCAL ? describe : describe.skip;

const TABLE_NAME = 'purchase-approvals-evidence-integration';
const ENDPOINT = process.env.DYNAMODB_LOCAL ?? '';

const baseClient = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const documentClient = DynamoDBDocumentClient.from(baseClient);

async function createTable(): Promise<void> {
  await baseClient.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'gsi1pk', AttributeType: 'S' },
        { AttributeName: 'gsi1sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );
  await baseClient.send(
    new UpdateTimeToLiveCommand({
      TableName: TABLE_NAME,
      TimeToLiveSpecification: { AttributeName: 'otpExpiresAt', Enabled: true },
    })
  );
}

async function dropTable(): Promise<void> {
  try {
    await baseClient.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
  } catch {
    // ignore teardown failures
  }
}

function waitForTable(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

async function readRequest(id: string): Promise<Record<string, unknown> | undefined> {
  const res = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `REQ#${id}`, SK: `REQ#${id}` } })
  );
  return res.Item as Record<string, unknown> | undefined;
}

function makeRequest(id: string): PurchaseRequest {
  const draft = PurchaseRequest.validateDraft({
    title: `Evidence request ${id}`,
    description: 'PDF evidence fixture',
    amount: 1500,
    requesterEmail: 'ana@example.com',
    approverEmails: ['bob@example.com', 'carol@example.com', 'dave@example.com'],
  });
  return PurchaseRequest.assemble({
    id,
    createdAt: new Date().toISOString(),
    draft,
    requesterName: 'Ana',
    approverNames: ['Bob', 'Carol', 'Dave'],
  });
}

const APPROVERS = [
  { email: 'bob@example.com', name: 'Bob', token: 'token-bob' },
  { email: 'carol@example.com', name: 'Carol', token: 'token-carol' },
  { email: 'dave@example.com', name: 'Dave', token: 'token-dave' },
];

/** Signs an approver row directly (simulates an earlier signature). */
async function preSign(id: string, email: string): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `REQ#${id}`, SK: `APPR#${email}`, email, name: email.split('@')[0],
        token: `token-${email.split('@')[0]}`, tokenStatus: 'ACTIVE', attempts: 0,
        validatedAt: '2026-08-14T08:30:00.000Z',
        status_signed: '2026-08-14T09:00:00.000Z',
        signature: { name: email.split('@')[0], timestamp: '2026-08-14T09:00:00.000Z' },
      },
    })
  );
}

/** Generator that always fails — simulates a pdf-lib crash (spec R4). */
class FailingGenerator implements EvidenceGeneratorPort {
  async generate(): Promise<Uint8Array> {
    throw new Error('pdf-lib exploded');
  }
}

maybeDescribe('pdf-evidence flow (integration, dynamodb-local + in-memory store)', () => {
  const requests = new DynamoDbRequestRepository({ tableName: TABLE_NAME, documentClient });
  const approvers = new DynamoDbApproverRepository({ tableName: TABLE_NAME, documentClient });
  const gate = new ApproverGate(requests, approvers);

  beforeAll(async () => {
    await createTable();
    await waitForTable();
    await documentClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: 'USER#ana@example.com', SK: 'USER#ana@example.com', gsi1pk: 'USER',
          gsi1sk: new Date().toISOString(), email: 'ana@example.com', name: 'Ana',
          position: 'Employee', createdAt: new Date().toISOString(),
        },
      })
    );
  });

  afterAll(async () => {
    await dropTable();
  });

  async function markAllValidated(id: string): Promise<void> {
    for (const a of APPROVERS) {
      await approvers.markValidated(id, a.email, '2026-08-14T08:30:00.000Z');
    }
  }

  it('3rd approve triggers generation: real PDF stored under the deterministic key + evidenceKey on the REQ row', async () => {
    const id = 'ev-approve';
    const store = new FakeEvidenceStore();
    const approve = new ApproveRequest(gate, approvers, requests, new PdfGenerator(), store);
    await requests.create(makeRequest(id), APPROVERS);
    await markAllValidated(id);
    await preSign(id, 'carol@example.com');
    await preSign(id, 'dave@example.com');

    const result = await approve.execute({ requestId: id, token: 'token-bob' });

    expect(result.status).toBe('COMPLETED');
    // deterministic key recorded on the REQ row (spec R2)
    const req = await readRequest(id);
    expect(req?.evidenceKey).toBe(`reqs/${id}/evidence.pdf`);
    // the in-memory store received REAL PDF bytes under that key
    const stored = store.objects.get(`reqs/${id}/evidence.pdf`);
    expect(stored).toBeDefined();
    const doc = await PDFDocument.load(stored as Uint8Array);
    expect(doc.getPageCount()).toBe(1);
  });

  it('download GET returns the real PDF bytes with application/pdf (R3)', async () => {
    const id = 'ev-download';
    const store = new FakeEvidenceStore();
    const approve = new ApproveRequest(gate, approvers, requests, new PdfGenerator(), store);
    await requests.create(makeRequest(id), APPROVERS);
    await markAllValidated(id);
    await preSign(id, 'carol@example.com');
    await preSign(id, 'dave@example.com');
    await approve.execute({ requestId: id, token: 'token-bob' });

    const download = buildDownload(requests, store);
    const res = await download({ pathParameters: { id } } as never);

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('application/pdf');
    expect(res.isBase64Encoded).toBe(true);
    const bytes = new Uint8Array(Buffer.from(res.body, 'base64'));
    // the downloaded bytes ARE a parseable PDF — the real generator output
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it('download returns 404 for a request that is not completed (R3)', async () => {
    const id = 'ev-pending';
    const store = new FakeEvidenceStore();
    await requests.create(makeRequest(id), APPROVERS);

    const download = buildDownload(requests, store);
    const res = await download({ pathParameters: { id } } as never);

    expect(res.statusCode).toBe(404);
  });

  it('generation failure keeps COMPLETED without evidenceKey and download stays 404 (R4)', async () => {
    const id = 'ev-fail';
    const store = new FakeEvidenceStore();
    const approve = new ApproveRequest(gate, approvers, requests, new FailingGenerator(), store);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await requests.create(makeRequest(id), APPROVERS);
    await markAllValidated(id);
    await preSign(id, 'carol@example.com');
    await preSign(id, 'dave@example.com');

    const result = await approve.execute({ requestId: id, token: 'token-bob' });

    expect(result.status).toBe('COMPLETED'); // status kept (R4)
    const req = await readRequest(id);
    expect(req?.evidenceKey).toBeUndefined(); // nothing recorded
    expect(store.objects.size).toBe(0); // nothing uploaded
    expect(errorSpy).toHaveBeenCalled(); // failure logged
    errorSpy.mockRestore();

    const download = buildDownload(requests, store);
    const res = await download({ pathParameters: { id } } as never);
    expect(res.statusCode).toBe(404); // until a successful generation exists
  });

  // Sanity: the helper reads approver rows through the same query shape the
  // adapter uses, keeping the suite honest about the real table layout.
  it('approver rows are queryable under PK=REQ#<id> (helper integrity)', async () => {
    const res = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': 'REQ#ev-approve', ':prefix': 'APPR#' },
      })
    );
    expect((res.Items ?? []).length).toBe(3);
  });
});
