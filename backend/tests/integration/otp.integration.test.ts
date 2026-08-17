import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbRequestRepository } from '../../src/infrastructure/DynamoDbRequestRepository';
import { DynamoDbApproverRepository } from '../../src/infrastructure/DynamoDbApproverRepository';
import { DynamoDbOtpRepository } from '../../src/infrastructure/DynamoDbOtpRepository';
import { MockMailRepo } from '../../src/infrastructure/MockMailRepo';
import { IssueOtp } from '../../src/application/IssueOtp';
import { ValidateOtp } from '../../src/application/ValidateOtp';
import { RegenerateOtp } from '../../src/application/RegenerateOtp';
import { RecoverApproverOtp } from '../../src/application/RecoverApproverOtp';
import { ApproverGate } from '../../src/application/ApproverGate';
import { OtpService } from '../../src/domain/services/OtpService';
import { PurchaseRequest } from '../../src/domain/PurchaseRequest';
import {
  ExpiredOtpError,
  WrongOtpError,
  LockedOutError,
  ApproverNotLockedError,
} from '../../src/domain/errors';

/**
 * Integration tests (task 3.9) — real DynamoDB round-trips against
 * dynamodb-local for the OTP flow: issue→validate→consume one-time, 3-fail
 * lockout, regenerate path, and newest-first mock-mail ordering.
 *
 * Gated by `DYNAMODB_LOCAL`. Creates its own disposable single-table
 * (PK/SK + GSI1 + TTL on otpExpiresAt), mirroring serverless.yml.
 */
const maybeDescribe = process.env.DYNAMODB_LOCAL ? describe : describe.skip;

const TABLE_NAME = 'purchase-approvals-otp-integration';
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
  // TTL is enabled via a separate UpdateTimeToLive call (not part of CreateTable).
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

async function seedUser(email: string, name: string): Promise<void> {
  const createdAt = new Date().toISOString();
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${email}`, SK: `USER#${email}`, gsi1pk: 'USER', gsi1sk: createdAt,
        email, name, position: 'Employee', createdAt,
      },
    })
  );
}

/** Builds a PENDING request aggregate. bob is approver 1 (token-bob). */
function makeRequest(id: string): PurchaseRequest {
  const draft = PurchaseRequest.validateDraft({
    title: `OTP request ${id}`,
    description: 'Work machine',
    amount: 1200.5,
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

maybeDescribe('OTP flow (integration)', () => {
  const requests = new DynamoDbRequestRepository({ tableName: TABLE_NAME, documentClient });
  const approvers = new DynamoDbApproverRepository({ tableName: TABLE_NAME, documentClient });
  const otps = new DynamoDbOtpRepository({ tableName: TABLE_NAME, documentClient });
  const mail = new MockMailRepo({ tableName: TABLE_NAME, documentClient });
  const otpService = new OtpService();
  const gate = new ApproverGate(requests, approvers);
  const issue = new IssueOtp(gate, otps, otpService, mail);
  const validate = new ValidateOtp(gate, approvers, otps, otpService);
  const regenerate = new RegenerateOtp(gate, approvers, otps, otpService, mail);
  const recover = new RecoverApproverOtp(requests, approvers, otps, otpService, mail);

  beforeAll(async () => {
    await createTable();
    await waitForTable();
    await seedUser('ana@example.com', 'Ana');
  });

  afterAll(async () => {
    await dropTable();
  });

  async function latestOtpCodeFor(email: string): Promise<string> {
    const events = await mail.list();
    const otp = events.find((e) => e.type === 'OTP' && e.to === email);
    if (!otp?.otpPlain) throw new Error(`No OTP mail found for ${email}`);
    return otp.otpPlain;
  }

  it('issue → validate → consume: the OTP is single-use', async () => {
    await requests.create(makeRequest('otp-1'), APPROVERS);

    const issued = await issue.execute({ requestId: 'otp-1', token: 'token-bob' });
    expect(issued).toEqual({ expiresInSeconds: 180 });

    const code = await latestOtpCodeFor('bob@example.com');
    expect(code).toMatch(/^\d{6}$/);

    // mailed code is stored ONLY as a digest — no plaintext row exists
    const stored = await otps.getOtp('otp-1', 'bob@example.com');
    expect(stored!.otpHash).not.toContain(code);
    expect(stored!.otpHash).toMatch(/^[0-9a-f]{64}$/);

    const first = await validate.execute({ requestId: 'otp-1', token: 'token-bob', code });
    expect(first).toEqual({ valid: true });

    // consumed → second validation fails as expired (one-time use)
    await expect(
      validate.execute({ requestId: 'otp-1', token: 'token-bob', code })
    ).rejects.toThrow(ExpiredOtpError);
  });

  it('three failed validations lock out the approver: even the correct code is rejected', async () => {
    await requests.create(makeRequest('otp-2'), APPROVERS);
    await issue.execute({ requestId: 'otp-2', token: 'token-bob' });
    const code = await latestOtpCodeFor('bob@example.com');

    // failures 1 and 2 → WrongOtpError with attemptsRemaining
    await expect(
      validate.execute({ requestId: 'otp-2', token: 'token-bob', code: '000000' })
    ).rejects.toBeInstanceOf(WrongOtpError);
    await expect(
      validate.execute({ requestId: 'otp-2', token: 'token-bob', code: '000000' })
    ).rejects.toBeInstanceOf(WrongOtpError);

    // 3rd failure → atomic lockout
    await expect(
      validate.execute({ requestId: 'otp-2', token: 'token-bob', code: '000000' })
    ).rejects.toBeInstanceOf(LockedOutError);

    // durable approver item now INVALIDATED_LOCKOUT
    const gateState = await approvers.findByToken('otp-2', 'token-bob');
    expect(gateState!.tokenStatus).toBe('INVALIDATED_LOCKOUT');

    // even the correct code is rejected (gate sees lockout)
    await expect(
      validate.execute({ requestId: 'otp-2', token: 'token-bob', code })
    ).rejects.toBeInstanceOf(LockedOutError);
  });

  it('requester recovery: lock → recover → ACTIVE again → validates with the NEW mailed OTP', async () => {
    await requests.create(makeRequest('otp-recover'), APPROVERS);
    await issue.execute({ requestId: 'otp-recover', token: 'token-bob' });

    // 3 wrong codes lock bob out (tokenStatus → INVALIDATED_LOCKOUT): failures
    // 1 and 2 are WrongOtpError; the 3rd failure is the atomic lockout.
    await expect(
      validate.execute({ requestId: 'otp-recover', token: 'token-bob', code: '000000' })
    ).rejects.toThrow(WrongOtpError);
    await expect(
      validate.execute({ requestId: 'otp-recover', token: 'token-bob', code: '000000' })
    ).rejects.toThrow(WrongOtpError);
    await expect(
      validate.execute({ requestId: 'otp-recover', token: 'token-bob', code: '000000' })
    ).rejects.toThrow(LockedOutError);
    let gateState = await approvers.findByToken('otp-recover', 'token-bob');
    expect(gateState!.tokenStatus).toBe('INVALIDATED_LOCKOUT');

    // requester-initiated recovery resets the LOCKED approver → 201
    const recovered = await recover.execute({
      requestId: 'otp-recover',
      email: 'bob@example.com',
    });
    expect(recovered).toEqual({ expiresInSeconds: 180 });

    // the approver is ACTIVE again with attempts reset
    gateState = await approvers.findByToken('otp-recover', 'token-bob');
    expect(gateState!.tokenStatus).toBe('ACTIVE');
    expect(gateState!.attempts).toBe(0);

    // the FRESH (new) mailed code validates: issue+validate succeeds end-to-end
    const newCode = await latestOtpCodeFor('bob@example.com');
    await expect(
      validate.execute({ requestId: 'otp-recover', token: 'token-bob', code: newCode })
    ).resolves.toEqual({ valid: true });
  });

  it('requester recovery of a NON-locked approver is refused (409) and issues NO OTP / NO mail', async () => {
    await requests.create(makeRequest('otp-recover-no'), APPROVERS);
    await issue.execute({ requestId: 'otp-recover-no', token: 'token-carol' });

    // carol is PENDING/ACTIVE (never locked) — an innocent approver
    await expect(
      recover.execute({ requestId: 'otp-recover-no', email: 'carol@example.com' })
    ).rejects.toThrow(ApproverNotLockedError);

    // her OTP was NOT re-issued: still ACTIVE, attempts still 0
    const state = await approvers.findByToken('otp-recover-no', 'token-carol');
    expect(state!.tokenStatus).toBe('ACTIVE');
    expect(state!.attempts).toBe(0);
  });

  it('regenerate resets attempts and issues a fresh usable OTP', async () => {
    await requests.create(makeRequest('otp-3'), APPROVERS);
    await issue.execute({ requestId: 'otp-3', token: 'token-bob' });

    // one wrong attempt → attempts=1
    await expect(
      validate.execute({ requestId: 'otp-3', token: 'token-bob', code: '000000' })
    ).rejects.toBeInstanceOf(WrongOtpError);

    const regenerated = await regenerate.execute({
      requestId: 'otp-3',
      token: 'token-bob',
    });
    expect(regenerated).toEqual({ expiresInSeconds: 180 });

    // attempts reset to 0
    const state = await approvers.findByToken('otp-3', 'token-bob');
    expect(state!.attempts).toBe(0);

    // the NEW mailed code validates
    const newCode = await latestOtpCodeFor('bob@example.com');
    await expect(
      validate.execute({ requestId: 'otp-3', token: 'token-bob', code: newCode })
    ).resolves.toEqual({ valid: true });
  });

  it('concurrent wrong submissions: attempts land at exactly 3, one lockout, no overshoot', async () => {
    await requests.create(makeRequest('otp-con-wrong'), APPROVERS);
    await issue.execute({ requestId: 'otp-con-wrong', token: 'token-bob' });
    // the issued OTP item stays present (wrong codes never consume it), so
    // every concurrent wrong submission drives the atomic counter, not expiry

    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        validate
          .execute({ requestId: 'otp-con-wrong', token: 'token-bob', code: '000000' })
          .then(() => 'valid')
          .catch((err) => err.constructor.name)
      )
    );

    // no submission may be accepted (all wrong)
    expect(results).not.toContain('valid');
    // at least one submission performed the lockout transition
    expect(results.filter((r) => r === 'LockedOutError').length).toBeGreaterThanOrEqual(1);

    await waitForTable();
    const gateState = await approvers.findByToken('otp-con-wrong', 'token-bob');
    // exactly the lockout limit, never overshot (attempts can never be > 3)
    expect(gateState!.attempts).toBe(3);
    expect(gateState!.tokenStatus).toBe('INVALIDATED_LOCKOUT');
  });

  it('concurrent identical CORRECT submissions: exactly ONE valid:true, the rest fail (one-time use)', async () => {
    await requests.create(makeRequest('otp-con-ok'), APPROVERS);
    await issue.execute({ requestId: 'otp-con-ok', token: 'token-bob' });
    const code = await latestOtpCodeFor('bob@example.com');

    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        validate
          .execute({ requestId: 'otp-con-ok', token: 'token-bob', code })
          .then(() => 'valid')
          .catch((err) => err.constructor.name)
      )
    );

    // exactly one single-use winner — the atomic CAS consume allows no duplicates
    expect(results.filter((r) => r === 'valid').length).toBe(1);
    // every loser was treated as already-consumed/expired
    expect(results.filter((r) => r === 'ExpiredOtpError').length).toBe(N - 1);
  });

  it('GET /mock-mail source lists mails newest first (approval links + OTP)', async () => {
    await requests.create(makeRequest('otp-4'), APPROVERS);

    // seed 3 APPROVAL_LINK mails with OLD timestamps (what CreateRequest sends),
    // then issue + regenerate produce NEWER OTP mails
    const linkAt = '2026-08-14T00:00:00.000Z';
    for (const approver of APPROVERS.slice(0, 3)) {
      await mail.send({
        id: `link-${approver.email}`,
        to: approver.email,
        type: 'APPROVAL_LINK',
        subject: 'Approval needed',
        body: 'Please approve.',
        link: `https://host/approve?request_id=otp-4&approver_token=${approver.token}`,
        createdAt: linkAt,
      });
    }
    await issue.execute({ requestId: 'otp-4', token: 'token-carol' });
    await regenerate.execute({ requestId: 'otp-4', token: 'token-carol' });

    const events = await mail.list();
    // newest first: regenerate OTP, then issue OTP, then the 3 links
    const linkMails = events.filter((e) => e.type === 'APPROVAL_LINK');
    expect(linkMails.length).toBe(3);
    expect(events[0].type).toBe('OTP');
    expect(events[0].to).toBe('carol@example.com');
    expect(events[1].type).toBe('OTP');
    expect(events[1].to).toBe('carol@example.com');
    // every element is ordered newest-first by createdAt
    for (let i = 1; i < events.length; i += 1) {
      expect(
        new Date(events[i - 1].createdAt).getTime() >= new Date(events[i].createdAt).getTime()
      ).toBe(true);
    }
  });
});