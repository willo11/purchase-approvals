import type { RequestDetail } from '../domain/PurchaseRequest';
import { UnknownRequestError } from '../domain/errors';
import { RequestRepository } from './ports/RequestRepository';

/**
 * Get a request detail use case (spec R4).
 *
 * Returns the request plus each approver record with its status and, when
 * present, signed/rejected timestamp. An unknown request id raises
 * {@link UnknownRequestError} → HTTP 404. Pure application logic — no
 * framework or AWS dependencies.
 */
export class GetRequestDetail {
  constructor(private readonly repository: RequestRepository) {}

  async execute(id: string): Promise<RequestDetail> {
    const detail = await this.repository.get(id);
    if (!detail) {
      throw new UnknownRequestError(`Request ${id} not found`);
    }
    return detail;
  }
}