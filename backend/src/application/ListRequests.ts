import type { RequestSummary } from '../domain/PurchaseRequest';
import { RequestRepository } from './ports/RequestRepository';

/**
 * List purchase requests use case (spec R3).
 *
 * Returns all requests ordered by creation date, newest first, via GSI1 (the
 * repository queries `gsi1pk=REQ` with `ScanIndexForward: false`). Pure
 * application logic — no framework or AWS dependencies.
 */
export class ListRequests {
  constructor(private readonly repository: RequestRepository) {}

  async execute(): Promise<RequestSummary[]> {
    return this.repository.list();
  }
}