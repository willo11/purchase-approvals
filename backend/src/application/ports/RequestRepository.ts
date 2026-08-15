import type { PurchaseRequest, RequestDetail, RequestSummary } from '../../domain/PurchaseRequest';

/**
 * A persisted approver row. `token` is the approval token issued for this
 * approver; `name` is the registry snapshot (design R1, concurrency §1).
 */
export interface ApproverStorageRecord {
  email: string;
  name: string;
  token: string;
}

/**
 * Persistence contract for the purchase-request core (design Decision 8).
 *
 * Single-table layout (design-concurrency.md §1):
 *   REQ   → PK=`REQ#<id>`, SK=`REQ#<id>`, gsi1pk=REQ, gsi1sk=createdAt
 *   APPR  → PK=`REQ#<id>`, SK=`APPR#<email>`
 *
 * `create` persists the REQ item plus all 3 approver records. `list` returns
 * newest-first summaries via GSI1; `get` returns the full detail (REQUEST +
 * approver set) or `undefined` for an unknown id (mapped to 404).
 */
export interface RequestRepository {
  create(request: PurchaseRequest, approvers: ApproverStorageRecord[]): Promise<void>;

  /** Lists request summaries, newest first (design R3). */
  list(): Promise<RequestSummary[]>;

  /** Returns the request detail including per-approver status, or `undefined`. */
  get(id: string): Promise<RequestDetail | undefined>;

  /**
   * Step B of a completion (design-concurrency §3): the EXCLUSIVE global CAS
   * on the REQUEST item. Sets `status=COMPLETED` + `completedAt` only if
   * `attribute_not_exists(completedAt)` still holds — the request has NOT yet
   * been completed. Returns `true` when THIS call moved `PENDING → COMPLETED`
   * (the single winner), `false` when a concurrent writer already did (the
   * loser must NOT generate evidence; spec R3 lookahead, task 4.2).
   */
  completeIfAbsent(id: string, completedAt: string): Promise<boolean>;

  /**
   * Step B of a reject (design-concurrency §4): the EXCLUSIVE global CAS on the
   * REQUEST item. Sets `status=REJECTED` + `rejectedAt`+`rejectedBy` only if
   * `status = PENDING AND attribute_not_exists(rejectedAt)`. Returns `true`
   * when THIS call moved `PENDING → REJECTED`, `false` when a concurrent
   * approve already CAS'd `COMPLETED` (so reject loses; R2 precedence
   * COMPLETED > REJECTED, task 4.3).
   */
  rejectIfPending(
    id: string,
    rejectorEmail: string,
    rejectedAt: string
  ): Promise<boolean>;

  /**
   * Records the evidence S3 key on the REQUEST item (design-concurrency §5).
   * A conditional `attribute_not_exists(evidenceKey)` makes the set IDEMPOTENT:
   * a replayed/retried completion can never double-record, and the guard read
   * before generation means the key is only written AFTER a successful
   * generate → store.put (spec R4 — a failed generation leaves `COMPLETED`
   * with no evidenceKey, so download stays 404). Returns `true` when THIS call
   * recorded the key, `false` when it was already set (no-op).
   */
  recordEvidence(id: string, evidenceKey: string): Promise<boolean>;
}