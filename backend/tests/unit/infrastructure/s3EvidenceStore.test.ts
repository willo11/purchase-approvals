import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  InMemoryEvidenceStore,
  S3EvidenceStore,
  makeEvidenceStore,
} from '../../../src/infrastructure/S3EvidenceStore';

/** Observable stand-in for S3Client with a mocked send(). */
function fakeClient(): { send: jest.Mock } {
  return { send: jest.fn() };
}

function makeStore(client: { send: jest.Mock }): S3EvidenceStore {
  return new S3EvidenceStore({
    bucket: 'evidence-bucket',
    client: client as unknown as S3Client,
  });
}

describe('S3EvidenceStore (task 5.2, spec R2)', () => {
  it('put sends PutObjectCommand with the deterministic key and application/pdf content type', async () => {
    const client = fakeClient();
    client.send.mockResolvedValue({});
    const store = makeStore(client);
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // "%PDF-1.4"

    await store.put('reqs/req-1/evidence.pdf', bytes);

    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.Bucket).toBe('evidence-bucket');
    expect(command.input.Key).toBe('reqs/req-1/evidence.pdf');
    expect(command.input.ContentType).toBe('application/pdf');
    expect(command.input.Body).toBe(bytes);
  });

  it('get returns the stored object bytes', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const client = fakeClient();
    client.send.mockResolvedValue({
      Body: { transformToByteArray: async () => bytes },
    });
    const store = makeStore(client);

    await expect(store.get('reqs/req-1/evidence.pdf')).resolves.toEqual(bytes);

    const [command] = client.send.mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.Bucket).toBe('evidence-bucket');
    expect(command.input.Key).toBe('reqs/req-1/evidence.pdf');
  });

  it('get returns undefined when the object does not exist (NoSuchKey → 404)', async () => {
    const client = fakeClient();
    client.send.mockRejectedValue(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));
    const store = makeStore(client);

    await expect(store.get('reqs/missing/evidence.pdf')).resolves.toBeUndefined();
  });

  it('get rethrows unexpected S3 errors (→ 500)', async () => {
    const client = fakeClient();
    client.send.mockRejectedValue(new Error('S3 exploded'));
    const store = makeStore(client);

    await expect(store.get('reqs/req-1/evidence.pdf')).rejects.toThrow('S3 exploded');
  });
});

describe('InMemoryEvidenceStore (EVIDENCE_STORE=memory, local demo)', () => {
  it('put + get round-trips the same bytes and returns void on put', async () => {
    const store = new InMemoryEvidenceStore();
    const bytes = new Uint8Array([37, 80, 68, 70]);

    const putResult = await store.put('reqs/req-1/evidence.pdf', bytes);

    expect(putResult).toBeUndefined();
    await expect(store.get('reqs/req-1/evidence.pdf')).resolves.toEqual(bytes);
  });

  it('get returns undefined for a key that was never stored (→ 404)', async () => {
    const store = new InMemoryEvidenceStore();

    await expect(store.get('reqs/missing/evidence.pdf')).resolves.toBeUndefined();
  });

  it('put overwrites the same key (deterministic evidence key semantics)', async () => {
    const store = new InMemoryEvidenceStore();
    await store.put('reqs/req-1/evidence.pdf', new Uint8Array([1]));
    await store.put('reqs/req-1/evidence.pdf', new Uint8Array([2, 3]));

    await expect(store.get('reqs/req-1/evidence.pdf')).resolves.toEqual(
      new Uint8Array([2, 3])
    );
  });
});

describe('makeEvidenceStore (env-driven store selection)', () => {
  const previous = process.env.EVIDENCE_STORE;
  const previousBucket = process.env.EVIDENCE_BUCKET;

  afterEach(() => {
    if (previous === undefined) delete process.env.EVIDENCE_STORE;
    else process.env.EVIDENCE_STORE = previous;
    if (previousBucket === undefined) delete process.env.EVIDENCE_BUCKET;
    else process.env.EVIDENCE_BUCKET = previousBucket;
  });

  it('returns the in-memory store when EVIDENCE_STORE=memory (local demo)', () => {
    process.env.EVIDENCE_STORE = 'memory';
    expect(makeEvidenceStore()).toBeInstanceOf(InMemoryEvidenceStore);
  });

  it('returns the S3 store when EVIDENCE_STORE is unset (deploy default)', () => {
    delete process.env.EVIDENCE_STORE;
    expect(makeEvidenceStore()).toBeInstanceOf(S3EvidenceStore);
  });

  it('shares ONE in-memory store across calls while EVIDENCE_STORE=memory (cross-handler PDF)', () => {
    // serverless-offline loads each Lambda function as its own handler module;
    // without a shared instance the approval handler puts the PDF into one map
    // and the download handler reads an empty one (404 on a completed request).
    process.env.EVIDENCE_STORE = 'memory';
    expect(makeEvidenceStore()).toBe(makeEvidenceStore());
  });
});
