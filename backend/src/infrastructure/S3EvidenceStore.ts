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
 * Composition root for the production S3 adapter (same pattern as
 * `makeRequestRepository`). Reads the bucket from `EVIDENCE_BUCKET` (set by
 * serverless.yml from `custom.bucketName`).
 */
export function makeEvidenceStore(): S3EvidenceStore {
  const bucket = process.env.EVIDENCE_BUCKET ?? 'purchase-approvals-evidence-dev';
  return new S3EvidenceStore({
    bucket,
    client: new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' }),
  });
}
