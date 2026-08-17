import { apiClient } from './client';
import { listRequests, getRequest } from './requests';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

describe('host requests API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('listRequests GETs /api/purchase-requests', async () => {
    apiClient.get.mockResolvedValue({ data: [{ id: 'r1' }] });
    const result = await listRequests();
    expect(apiClient.get).toHaveBeenCalledWith('/api/purchase-requests');
    expect(result).toEqual([{ id: 'r1' }]);
  });

  test('getRequest GETs /api/purchase-requests/{id}', async () => {
    apiClient.get.mockResolvedValue({ data: { id: 'r1' } });
    const result = await getRequest('r1');
    expect(apiClient.get).toHaveBeenCalledWith('/api/purchase-requests/r1');
    expect(result).toEqual({ id: 'r1' });
  });
});