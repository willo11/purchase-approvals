import type {
  PurchaseRequest,
  RequestDetail,
  RequestSummary,
} from '../../../src/domain/PurchaseRequest';
import {
  RequestRepository,
  ApproverStorageRecord,
} from '../../../src/application/ports/RequestRepository';
import type { FakeApproverRepository } from './fakeApproverRepository';

/** Exact Step B completion CAS condition emitted to the fake (design-concurrency §3). */
const COMPLETION_CONDITION = 'attribute_not_exists(completedAt)';
/** Exact Step B reject CAS condition emitted to the fake (design-concurrency §4). */
const REJECT_CONDITION = 'status = :pending AND attribute_not_exists(rejectedAt)';

/**
 * In-memory fake for the {@link RequestRepository}.
 *
 * Lets unit tests drive the purchase-request use cases and handlers without
 * AWS. Records created requests+approvers, lists newest-first (R3), returns
 * detail / undefined for get (R4).
 */
export class FakeRequestRepository implements RequestRepository {
  private details: RequestDetail[] = [];
  private seeds: RequestSummary[] = [];
  private aproversByRequest = new Map<string, ApproverStorageRecord[]>();

  createCalls = 0;
  listCalls = 0;
  getCalls = 0;
  completeCalls = 0;
  rejectCalls = 0;
  lastCompleteCondition = '';
  lastRejectCondition = '';
  /** When true, `completeIfAbsent` reports a concurrent writer already completed. */
  simulateAlreadyCompleted = false;
  /** Mirrors real DDB: the approver rows are the source of truth for status. */
  private approverSource?: FakeApproverRepository;

  /**
   * Wires the approver-row source so `get` reflects signed/rejected timestamps
   * written by the approver repository — same as the real adapter querying the
   * `APPR#<email>` rows after a signature CAS.
   */
  useApproverSource(source: FakeApproverRepository): this {
    this.approverSource = source;
    return this;
  }

  lastApprovers: ApproverStorageRecord[] = [];

  /** Pre-seeds summaries for list ordering tests (insertion = creation order). */
  seedSummaries(...summaries: RequestSummary[]): this {
    this.seeds.push(...summaries);
    return this;
  }

  /** Pre-seeds a detail for the get path. */
  seedDetail(detail: RequestDetail): this {
    this.details.push(detail);
    return this;
  }

  async create(request: PurchaseRequest, approvers: ApproverStorageRecord[]): Promise<void> {
    this.createCalls += 1;
    this.lastApprovers = approvers;
    this.aproversByRequest.set(request.getId(), approvers);
    this.details.push(request.toDetail());
  }

  async list(): Promise<RequestSummary[]> {
    this.listCalls += 1;
    if (this.details.length === 0) {
      return [...this.seeds].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    // newest first (R3); equal createdAt keeps the later-created one first
    return [...this.details]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => this.fromDetail(d));
  }

  async get(id: string): Promise<RequestDetail | undefined> {
    this.getCalls += 1;
    const detail = this.details.find((d) => d.id === id);
    if (!detail) return undefined;
    if (!this.approverSource) return detail;
    // Mirror the real adapter: re-derive each approver's displayed status from
    // the durable APPR row (the source of truth for status_signed/rejected).
    return {
      ...detail,
      approvers: detail.approvers.map((a) => {
        const row = this.approverSource?.gateState(id, a.email);
        if (row?.status_signed) {
          return { ...a, status: 'SIGNED' as const, signedAt: row.status_signed };
        }
        if (row?.status_rejected) {
          return { ...a, status: 'REJECTED' as const, rejectedAt: row.status_rejected };
        }
        return { ...a, status: 'PENDING' as const };
      }),
    };
  }

  async completeIfAbsent(id: string, completedAt: string): Promise<boolean> {
    this.completeCalls += 1;
    this.lastCompleteCondition = COMPLETION_CONDITION;
    const detail = this.details.find((d) => d.id === id);
    if (!detail || detail.status === 'COMPLETED' || this.simulateAlreadyCompleted) {
      return false;
    }
    this.setStatus(id, 'COMPLETED', completedAt);
    return true;
  }

  async rejectIfPending(
    id: string,
    _rejectorEmail: string,
    rejectedAt: string
  ): Promise<boolean> {
    this.rejectCalls += 1;
    this.lastRejectCondition = REJECT_CONDITION;
    const detail = this.details.find((d) => d.id === id);
    if (!detail || detail.status !== 'PENDING') return false;
    this.setStatus(id, 'REJECTED', rejectedAt);
    return true;
  }

  private setStatus(id: string, status: RequestDetail['status'], _at: string): void {
    this.details = this.details.map((d) => (d.id === id ? { ...d, status } : d));
  }

  storedApprovers(id: string): ApproverStorageRecord[] {
    return this.aproversByRequest.get(id) ?? [];
  }

  private fromDetail(detail: RequestDetail): RequestSummary {
    return {
      id: detail.id,
      title: detail.title,
      amount: detail.amount,
      currency: detail.currency,
      status: detail.status,
      createdAt: detail.createdAt,
    };
  }
}