import { act, renderHook, waitFor } from '@testing-library/react';
import { apiClient } from '@/api/client';
import { useApprove } from './useApprove';
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

describe('useApprove — approve without a name (R3, task 7.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApprovalFlowStore();
    seedStore();
  });

  test('success → approved terminal, no name is sent (endpoint #10 has no body)', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'r1' } });
    const { result } = renderHook(() => useApprove());
    await act(async () => result.current.approve());
    expect(apiClient.post).toHaveBeenCalledWith('/api/approvals/r1/token/t1/approve');
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.APPROVED);
  });

  test('409 already signed → already-signed terminal (R4 reload)', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already signed the request' } },
    });
    const { result } = renderHook(() => useApprove());
    await act(async () => result.current.approve());
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.ALREADY_SIGNED);
  });

  test('410 request terminal → completed terminal', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 410, data: { error: 'TerminalRequestError', message: 'Request r1 is already COMPLETED; no OTP flow is offered' } },
    });
    const { result } = renderHook(() => useApprove());
    await act(async () => result.current.approve());
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.COMPLETED);
  });

  test('network failure → error surfaced, flow stays on decision', async () => {
    apiClient.post.mockRejectedValueOnce(new Error('Network Error'));
    const { result } = renderHook(() => useApprove());
    await act(async () => result.current.approve());
    expect(result.current.error.status).toBe(0);
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.DECISION);
  });

  test('clearError drops the surfaced error so the buttons re-enable', async () => {
    apiClient.post.mockRejectedValueOnce(new Error('Network Error'));
    const { result } = renderHook(() => useApprove());
    await act(async () => result.current.approve());
    expect(result.current.error).not.toBeNull();
    await act(async () => result.current.clearError());
    expect(result.current.error).toBeNull();
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.DECISION);
  });
});
