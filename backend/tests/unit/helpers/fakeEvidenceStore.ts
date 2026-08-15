import type { EvidenceStorePort } from '../../../src/application/ports/EvidenceStorePort';

/**
 * In-memory fake for the {@link EvidenceStorePort} (task 5.2/5.3 seam).
 *
 * Stores REAL bytes in a Map, exactly like S3 does for the completion flow —
 * integration tests inject this instead of LocalStack and still round-trip
 * genuine PDF bytes through generate → put → get → download. Records put/get
 * calls so unit tests can assert the deterministic key and ordering.
 */
export class FakeEvidenceStore implements EvidenceStorePort {
  readonly objects = new Map<string, Uint8Array>();
  readonly putCalls: Array<{ key: string; bytes: Uint8Array }> = [];
  readonly getCalls: string[] = [];
  /** When true, the next put throws (simulates an S3 upload failure, spec R4). */
  failNextPut = false;

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.putCalls.push({ key, bytes });
    if (this.failNextPut) {
      throw new Error('S3 put failed (simulated)');
    }
    this.objects.set(key, bytes);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    this.getCalls.push(key);
    return this.objects.get(key);
  }
}
