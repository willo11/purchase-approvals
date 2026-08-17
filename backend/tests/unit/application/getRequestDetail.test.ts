import { GetRequestDetail } from '../../../src/application/GetRequestDetail';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';
import { UnknownRequestError } from '../../../src/domain/errors';
import type { RequestDetail } from '../../../src/domain/PurchaseRequest';

const detail: RequestDetail = {
  id: 'req-1',
  title: 'Laptop',
  description: 'Work machine',
  amount: 1200,
  currency: 'USD',
  status: 'PENDING',
  createdBy: { email: 'ana@example.com', name: 'Ana' },
  approvers: [
    { email: 'bob@example.com', name: 'Bob', status: 'SIGNED', locked: false, signedAt: '2026-08-14T00:00:00.000Z' },
    { email: 'carol@example.com', name: 'Carol', status: 'PENDING', locked: false },
    { email: 'dave@example.com', name: 'Dave', status: 'PENDING', locked: true },
  ],
  createdAt: '2026-08-14T00:00:00.000Z',
};

describe('GetRequestDetail use case (R4)', () => {
  it('returns the request detail with per-approver status', async () => {
    const repo = new FakeRequestRepository().seedDetail(detail);
    const useCase = new GetRequestDetail(repo);

    const result = await useCase.execute('req-1');

    expect(result.id).toBe('req-1');
    expect(result.approvers[0]).toEqual({
      email: 'bob@example.com',
      name: 'Bob',
      status: 'SIGNED',
      locked: false,
      signedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(result.approvers.map((a) => a.status)).toEqual(['SIGNED', 'PENDING', 'PENDING']);
    // the locked state is threaded through the detail (dave is locked)
    expect(result.approvers.map((a) => a.locked)).toEqual([false, false, true]);
  });

  it('raises UnknownRequestError (→404) for an unknown id', async () => {
    const useCase = new GetRequestDetail(new FakeRequestRepository());

    await expect(useCase.execute('missing')).rejects.toThrow(UnknownRequestError);
  });
});