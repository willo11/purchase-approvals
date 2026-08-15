import { apiClient } from './client';
import { createRequest, downloadEvidence, getRequest, listRequests } from './requests';
import { listUsers } from './users';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

describe('requests API (endpoints #3/#4/#5/#6)', () => {
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
    await getRequest('r1');
    expect(apiClient.get).toHaveBeenCalledWith('/api/purchase-requests/r1');
  });

  test('createRequest POSTs the create payload', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'r1' } });
    const payload = {
      title: 'Laptops',
      description: 'New gear',
      amount: 2500,
      requesterEmail: 'carol@x.com',
      approverEmails: ['a@x.com', 'b@x.com', 'c@x.com'],
    };
    const result = await createRequest(payload);
    expect(apiClient.post).toHaveBeenCalledWith('/api/purchase-requests', payload);
    expect(result).toEqual({ id: 'r1' });
  });

  test('downloadEvidence GETs the PDF as a blob', async () => {
    apiClient.get.mockResolvedValue({ data: new Blob() });
    await downloadEvidence('r1');
    expect(apiClient.get).toHaveBeenCalledWith('/api/purchase-requests/r1/evidence.pdf', {
      responseType: 'blob',
    });
  });
});

describe('users API (endpoint #2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('listUsers GETs /api/users', async () => {
    apiClient.get.mockResolvedValue({ data: [{ name: 'Carol', email: 'carol@x.com' }] });
    const result = await listUsers();
    expect(apiClient.get).toHaveBeenCalledWith('/api/users');
    expect(result).toEqual([{ name: 'Carol', email: 'carol@x.com' }]);
  });
});
