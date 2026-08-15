import { apiClient } from './client';
import {
  issueOtp,
  validateOtp,
  regenerateOtp,
  approveRequest,
  rejectRequest,
  getRequestDetail,
} from './approvals';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

const REQ = 'req-1';
const TOKEN = 'tok-1';

describe('approvals API (endpoints #5/#7/#8/#9/#10/#11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('issueOtp POSTs .../otp and returns { expiresInSeconds } (#7)', async () => {
    apiClient.post.mockResolvedValue({ data: { expiresInSeconds: 180 } });
    const result = await issueOtp(REQ, TOKEN);
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api/approvals/${REQ}/token/${TOKEN}/otp`
    );
    expect(result).toEqual({ expiresInSeconds: 180 });
  });

  test('validateOtp POSTs .../otp/validate with { code } (#8)', async () => {
    apiClient.post.mockResolvedValue({ data: { valid: true } });
    const result = await validateOtp(REQ, TOKEN, '123456');
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api/approvals/${REQ}/token/${TOKEN}/otp/validate`,
      { code: '123456' }
    );
    expect(result).toEqual({ valid: true });
  });

  test('regenerateOtp POSTs .../otp/regenerate (#9)', async () => {
    apiClient.post.mockResolvedValue({ data: { expiresInSeconds: 180 } });
    await regenerateOtp(REQ, TOKEN);
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api/approvals/${REQ}/token/${TOKEN}/otp/regenerate`
    );
  });

  test('approveRequest POSTs .../approve with NO body (#10, no name input)', async () => {
    apiClient.post.mockResolvedValue({ data: { id: REQ } });
    await approveRequest(REQ, TOKEN);
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api/approvals/${REQ}/token/${TOKEN}/approve`
    );
  });

  test('rejectRequest POSTs .../reject with { confirm: true } (#11)', async () => {
    apiClient.post.mockResolvedValue({ data: { id: REQ } });
    await rejectRequest(REQ, TOKEN);
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api/approvals/${REQ}/token/${TOKEN}/reject`,
      { confirm: true }
    );
  });

  test('getRequestDetail GETs the request detail (#5)', async () => {
    apiClient.get.mockResolvedValue({ data: { id: REQ } });
    const result = await getRequestDetail(REQ);
    expect(apiClient.get).toHaveBeenCalledWith(`/api/purchase-requests/${REQ}`);
    expect(result).toEqual({ id: REQ });
  });
});
