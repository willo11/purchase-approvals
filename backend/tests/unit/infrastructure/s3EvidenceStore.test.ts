import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3EvidenceStore } from '../../../src/infrastructure/S3EvidenceStore';

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
