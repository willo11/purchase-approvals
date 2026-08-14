import { ListRequests } from '../../../src/application/ListRequests';
import { FakeRequestRepository } from '../helpers/fakeRequestRepository';

describe('ListRequests use case (R3)', () => {
  it('returns an empty list when no requests exist', async () => {
    const useCase = new ListRequests(new FakeRequestRepository());
    await expect(useCase.execute()).resolves.toEqual([]);
  });

  it('returns requests newest first', async () => {
    const repo = new FakeRequestRepository().seedSummaries(
      {
        id: 'old',
        title: 'Old',
        amount: 10,
        currency: 'USD',
        status: 'PENDING',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'new',
        title: 'New',
        amount: 20,
        currency: 'USD',
        status: 'PENDING',
        createdAt: '2026-08-10T00:00:00.000Z',
      }
    );
    const useCase = new ListRequests(repo);

    const summaries = await useCase.execute();

    expect(summaries.map((s) => s.id)).toEqual(['new', 'old']);
    expect(repo.listCalls).toBe(1);
  });
});