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
}