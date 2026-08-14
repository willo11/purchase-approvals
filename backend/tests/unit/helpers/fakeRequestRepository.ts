import type {
  PurchaseRequest,
  RequestDetail,
  RequestSummary,
} from '../../../src/domain/PurchaseRequest';
import {
  RequestRepository,
  ApproverStorageRecord,
} from '../../../src/application/ports/RequestRepository';

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
    return this.details.find((d) => d.id === id);
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