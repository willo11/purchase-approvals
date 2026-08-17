import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { EvidenceStorePort } from '../application/ports/EvidenceStorePort';

/** Environment the S3 adapter needs: bucket name + a configured S3 client. */
export interface S3EvidenceStoreEnv {
  bucket: string;
  client: S3Client;
}

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * AWS S3 adapter for the {@link EvidenceStorePort} (task 5.2, spec R2). The
 * PDF is stored under the deterministic key with `ContentType:
 * application/pdf`, so API Gateway/Lambda can serve the exact bytes back on
 * download (spec R3). A missing object surfaces as `undefined` (→ HTTP 404),
 * never as an exception.
 */
export class S3EvidenceStore implements EvidenceStorePort {
  constructor(private readonly env: S3EvidenceStoreEnv) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.env.client.send(
      new PutObjectCommand({
        Bucket: this.env.bucket,
        Key: key,
        Body: bytes,
        ContentType: 'application/pdf',
      })
    );
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const result = await this.env.client.send(
        new GetObjectCommand({ Bucket: this.env.bucket, Key: key })
      );
      return (await result.Body?.transformToByteArray()) as Uint8Array | undefined;
    } catch (err) {
      if (isNoSuchKey(err)) return undefined;
      throw err;
    }
  }
}

/**
 * Composition root for the evidence store, driven by the environment.
 *
 * - `EVIDENCE_STORE=memory` (local demo) → {@link InMemoryEvidenceStore}; the
 *   PDF flow works end-to-end without AWS credentials (S3 would 404/500
 *   locally because the download handler cannot reach the bucket).
 * - unset (deploy) → the real {@link S3EvidenceStore} (unchanged behavior);
 *   keep the variable REMOVED in `backend/.env` before deploying.
 *
 * The memory store is a PROCESS-WIDE singleton, and `pnpm run dev` starts
 * `serverless offline --useInProcess` so all Lambda handlers run in that same
 * process (serverless-offline's DEFAULT is one isolated worker thread per
 * function — the approval handler would put the PDF into its isolate's map
 * and the download handler would read an empty one, 404ing every download
 * even though generation succeeded).
 */
let sharedMemoryStore: InMemoryEvidenceStore | undefined;

export function makeEvidenceStore(): EvidenceStorePort {
  if (process.env.EVIDENCE_STORE === 'memory') {
    sharedMemoryStore ??= new InMemoryEvidenceStore();
    return sharedMemoryStore;
  }
  const bucket = process.env.EVIDENCE_BUCKET ?? 'purchase-approvals-evidence-dev';
  return new S3EvidenceStore({
    bucket,
    client: new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' }),
  });
}

/**
 * Process-local evidence store for the LOCAL demo (`EVIDENCE_STORE=memory`).
 *
 * Same {@link EvidenceStorePort} semantics as the S3 adapter: `put` stores
 * the bytes under the key (returns void), `get` returns the bytes or
 * `undefined` (→ HTTP 404). Backed by a Map — the data only lives for the
 * process lifetime, which is exactly what a local demo needs and why deploy
 * must keep the S3 default.
 */
export class InMemoryEvidenceStore implements EvidenceStorePort {
  private readonly objects = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(key, bytes);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key);
  }
}
