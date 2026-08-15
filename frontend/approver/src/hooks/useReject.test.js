import { act, renderHook } from '@testing-library/react';
import { apiClient } from '@/api/client';
import { useReject } from './useReject';
import {
  FLOW_PHASES,
  TERMINAL_VARIANTS,
  resetApprovalFlowStore,
  useApprovalFlowStore,
} from '@/store/useApprovalFlowStore';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

function seedStore() {
  useApprovalFlowStore.getState().startFlow({ requestId: 'r1', approverToken: 't1' });
  useApprovalFlowStore.getState().enterDecision();
}

describe('useReject — reject with confirmation (R3, task 7.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApprovalFlowStore();
    seedStore();
  });

  test('success → rejected terminal, POST carries { confirm: true }', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'r1' } });
    const { result } = renderHook(() => useReject());
    await act(async () => result.current.reject());
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/approvals/r1/token/t1/reject',
      { confirm: true }
    );
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.REJECTED);
  });

  test('409 already rejected → already-rejected terminal (R4 reload)', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already rejected the request' } },
    });
    const { result } = renderHook(() => useReject());
    await act(async () => result.current.reject());
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.ALREADY_REJECTED);
  });

  test('network failure → error surfaced, flow stays on decision', async () => {
    apiClient.post.mockRejectedValueOnce(new Error('Network Error'));
    const { result } = renderHook(() => useReject());
    await act(async () => result.current.reject());
    expect(result.current.error.status).toBe(0);
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.DECISION);
  });
});
