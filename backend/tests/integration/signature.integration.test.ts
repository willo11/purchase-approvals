import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbRequestRepository } from '../../src/infrastructure/DynamoDbRequestRepository';
import { DynamoDbApproverRepository } from '../../src/infrastructure/DynamoDbApproverRepository';
import { ApproveRequest } from '../../src/application/ApproveRequest';
import { RejectRequest } from '../../src/application/RejectRequest';
import { ApproverGate } from '../../src/application/ApproverGate';
import { AlreadyActedError, TerminalRequestError, OtpNotValidatedError } from '../../src/domain/errors';
import { PurchaseRequest } from '../../src/domain/PurchaseRequest';
import { FakeEvidenceGenerator } from '../unit/helpers/fakeEvidenceGenerator';
import { FakeEvidenceStore } from '../unit/helpers/fakeEvidenceStore';

/**
 * THE concurrency core (task 4.7, design-concurrency §3/§4): real DynamoDB
 * CAS races against dynamodb-local.
 *
 *   - Promise.all of two concurrent approves on a request with 1 pre-signed
 *     approver → exactly ONE `completedAt` (the exclusive global CAS), BOTH
 *     signatures recorded, and evidence generated exactly once (the winner).
 *   - approve-vs-reject race → exactly one global winner (completed XOR
 *     rejected), never both.
 *   - repository-level race: `completeIfAbsent` vs `rejectIfPending` on the
 *     same PENDING item → exactly one returns true (the single REQ lock).
 *   - same approver repeat → 409 (gate 4th check) / Step A CAS.
 *
 * Gated by `DYNAMODB_LOCAL`. Disposable single table mirroring serverless.yml.
 */
const maybeDescribe = process.env.DYNAMODB_LOCAL ? describe : describe.skip;

const TABLE_NAME = 'purchase-approvals-signature-integration';
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

async function readApproverRows(id: string): Promise<Record<string, unknown>[]> {
  const res = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `REQ#${id}`, ':prefix': 'APPR#' },
    })
  );
  return (res.Items ?? []) as Record<string, unknown>[];
}

/** Builds a PENDING request. Approvers bob/carol/dave with fixed tokens. */
function makeRequest(id: string): PurchaseRequest {
  const draft = PurchaseRequest.validateDraft({
    title: `Signature request ${id}`,
    description: 'Concurrency fixture',
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

maybeDescribe('approval-signature concurrency CAS (integration)', () => {
  const requests = new DynamoDbRequestRepository({ tableName: TABLE_NAME, documentClient });
  const approvers = new DynamoDbApproverRepository({ tableName: TABLE_NAME, documentClient });
  const gate = new ApproverGate(requests, approvers);
  const evidence = new FakeEvidenceGenerator();
  const evidenceStore = new FakeEvidenceStore();
  const approve = new ApproveRequest(gate, approvers, requests, evidence, evidenceStore);
  const reject = new RejectRequest(gate, approvers, requests);

  /**
   * Marks every approver validated — the real flow's OTP validation writes
   * this marker (ValidateOtp → markValidated) BEFORE any approve/reject
   * (spec R1/R2).
   */
  async function markAllValidated(id: string): Promise<void> {
    for (const a of APPROVERS) {
      await approvers.markValidated(id, a.email, '2026-08-14T08:30:00.000Z');
    }
  }

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

  it('Promise.all of two concurrent approves: exactly ONE completedAt, BOTH signatures, evidence once', async () => {
    evidence.calls = 0;
    await requests.create(makeRequest('sig-con-approve'), APPROVERS);
    await markAllValidated('sig-con-approve');
    await preSign('sig-con-approve', 'dave@example.com'); // 1 already signed

    // bob + carol approve CONCURRENTLY (spec R4 scenario)
    await Promise.all([
      approve.execute({ requestId: 'sig-con-approve', token: 'token-bob' }),
      approve.execute({ requestId: 'sig-con-approve', token: 'token-carol' }),
    ]);

    const req = await readRequest('sig-con-approve');
    expect(req?.status).toBe('COMPLETED');
    // exactly ONE completedAt — the exclusive global CAS allows a single writer
    expect(typeof req?.completedAt).toBe('string');

    const rows = await readApproverRows('sig-con-approve');
    const signed = rows.filter((r) => r.status_signed);
    // BOTH concurrent signatures recorded (no lost update) + the pre-signed one
    expect(signed.length).toBe(3);
    expect(rows.some((r) => r.email === 'bob@example.com' && r.status_signed)).toBe(true);
    expect(rows.some((r) => r.email === 'carol@example.com' && r.status_signed)).toBe(true);
    // ONLY the completion-CAS winner generated evidence
    expect(evidence.calls).toBe(1);
  });

  it('approve-vs-reject race: exactly one global winner (completed XOR rejected)', async () => {
    evidence.calls = 0;
    await requests.create(makeRequest('sig-con-vs'), APPROVERS);
    await markAllValidated('sig-con-vs');
    // 2 pre-signed: the 3rd approver racing approve vs reject decides globally
    await preSign('sig-con-vs', 'carol@example.com');
    await preSign('sig-con-vs', 'dave@example.com');

    const results = await Promise.allSettled([
      approve.execute({ requestId: 'sig-con-vs', token: 'token-bob' }),
      reject.execute({ requestId: 'sig-con-vs', token: 'token-bob' }),
    ]);
    // exactly ONE action committed; the loser hit Step A CAS → already-acted
    const settled = results.filter((r) => r.status === 'fulfilled');
    expect(settled.length).toBe(1);

    const req = await readRequest('sig-con-vs');
    const terminal = [req?.status === 'COMPLETED', req?.status === 'REJECTED'].filter(Boolean);
    expect(terminal.length).toBe(1); // exactly one terminal outcome
    // completed XOR rejected — never both, never neither
    const hasCompleted = req?.completedAt !== undefined;
    const hasRejected = req?.rejectedAt !== undefined;
    expect(hasCompleted ? !hasRejected : hasRejected).toBe(true);
  });

  it('two concurrent completion writers: exactly ONE wins the REQ CAS (single completedAt lock)', async () => {
    await requests.create(makeRequest('sig-req-lock'), APPROVERS);

    const outcome = await Promise.all([
      requests.completeIfAbsent('sig-req-lock', '2026-08-14T12:00:00.000Z'),
      requests.completeIfAbsent('sig-req-lock', '2026-08-14T12:00:01.000Z'),
    ]);
    // the single lock on the REQUEST item allows exactly one conditional write
    expect(outcome.filter(Boolean).length).toBe(1);

    const req = await readRequest('sig-req-lock');
    expect(req?.status).toBe('COMPLETED');
    expect(typeof req?.completedAt).toBe('string'); // one timestamp, not an array
  });

  it('repo-level cross-direction race: completeIfAbsent vs rejectIfPending — exactly ONE winner, never both flags', async () => {
    // The regression this probes (fresh-review FIX 1): with only
    // `attribute_not_exists(completedAt)`, the completion CAS could still pass
    // AFTER a reject set REJECTED, flipping the request back to COMPLETED with
    // BOTH completedAt and rejectedAt present. With the symmetric
    // `#status = :pending` guard, exactly one of the two conditional writes can
    // pass per request, every time.
    for (let i = 0; i < 10; i += 1) {
      const id = `sig-cross-${i}`;
      await requests.create(makeRequest(id), APPROVERS);

      const outcome = await Promise.all([
        requests.completeIfAbsent(id, '2026-08-14T12:00:00.000Z'),
        requests.rejectIfPending(id, 'bob@example.com', '2026-08-14T12:00:01.000Z'),
      ]);

      // exactly ONE conditional write won the single REQ lock
      expect(outcome.filter(Boolean).length).toBe(1);

      const req = await readRequest(id);
      const hasCompleted = req?.completedAt !== undefined;
      const hasRejected = req?.rejectedAt !== undefined;
      // completed XOR rejected — both flags NEVER coexist, and one ALWAYS lands
      expect(hasCompleted ? !hasRejected : hasRejected).toBe(true);
      expect(req?.status).toBe(hasCompleted ? 'COMPLETED' : 'REJECTED');
    }
  });

  it('same approver repeat: second approve is blocked (already acted → 409)', async () => {
    await requests.create(makeRequest('sig-repeat'), APPROVERS);
    await markAllValidated('sig-repeat');
    await approve.execute({ requestId: 'sig-repeat', token: 'token-bob' });

    await expect(
      approve.execute({ requestId: 'sig-repeat', token: 'token-bob' })
    ).rejects.toBeInstanceOf(AlreadyActedError);

    const req = await readRequest('sig-repeat');
    expect(req?.status).toBe('PENDING'); // single signature does not complete
    const rows = await readApproverRows('sig-repeat');
    const bob = rows.find((r) => r.email === 'bob@example.com');
    expect(bob?.status_signed).toBeDefined();
    // no second signature record (no double sign)
    expect(typeof bob?.status_signed).toBe('string');
  });

  it('after a rejection every other approver link is terminal (R2)', async () => {
    await requests.create(makeRequest('sig-rejected'), APPROVERS);
    await markAllValidated('sig-rejected');
    await reject.execute({ requestId: 'sig-rejected', token: 'token-bob' });

    await expect(
      gate.resolve('sig-rejected', 'token-carol')
    ).rejects.toBeInstanceOf(TerminalRequestError);
    await expect(
      approve.execute({ requestId: 'sig-rejected', token: 'token-carol' })
    ).rejects.toBeInstanceOf(TerminalRequestError);
  });

  it('an approver who never validated an OTP gets 401 before acting (spec R1/R2)', async () => {
    await requests.create(makeRequest('sig-not-validated'), APPROVERS);
    // NOTE: no markAllValidated here — the rows have no validatedAt marker

    await expect(
      approve.execute({ requestId: 'sig-not-validated', token: 'token-bob' })
    ).rejects.toBeInstanceOf(OtpNotValidatedError);

    const req = await readRequest('sig-not-validated');
    expect(req?.status).toBe('PENDING'); // nothing was written
    const rows = await readApproverRows('sig-not-validated');
    expect(rows.some((r) => r.status_signed)).toBe(false);
  });
});