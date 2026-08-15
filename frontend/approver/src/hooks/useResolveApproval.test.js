import { act, renderHook, waitFor } from '@testing-library/react';
import { apiClient } from '@/api/client';
import { useResolveApproval } from './useResolveApproval';
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

describe('useResolveApproval — gate (R1, task 7.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApprovalFlowStore();
  });

  test('missing link params → invalid-link terminal, no API call', () => {
    const { result } = renderHook(() => useResolveApproval({ requestId: null, approverToken: null }));
    const state = useApprovalFlowStore.getState();
    expect(state.phase).toBe(FLOW_PHASES.TERMINAL);
    expect(state.terminalVariant).toBe(TERMINAL_VARIANTS.INVALID_LINK);
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(result.current.state).toBe('ready');
  });

  test('201 { expiresInSeconds } → OTP entry', async () => {
    apiClient.post.mockResolvedValue({ data: { expiresInSeconds: 180 } });
    renderHook(() => useResolveApproval({ requestId: 'r1', approverToken: 't1' }));
    await waitFor(() => expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.OTP));
    expect(useApprovalFlowStore.getState().expiresInSeconds).toBe(180);
    expect(apiClient.post).toHaveBeenCalledWith('/api/approvals/r1/token/t1/otp');
  });

  test('410 terminal → completed terminal screen', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 410, data: { error: 'TerminalRequestError', message: 'Request r1 is already COMPLETED; no OTP flow is offered' } },
    });
    renderHook(() => useResolveApproval({ requestId: 'r1', approverToken: 't1' }));
    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.COMPLETED)
    );
  });

  test('403 lockout → locked-out screen', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 403, data: { error: 'LockedOutError', message: 'Approver token is invalidated (lockout)' } },
    });
    renderHook(() => useResolveApproval({ requestId: 'r1', approverToken: 't1' }));
    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.LOCKED_OUT)
    );
  });

  test('404 unknown token → invalid-link screen', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 404, data: { error: 'UnknownTokenError', message: 'Token does not resolve to this approver' } },
    });
    renderHook(() => useResolveApproval({ requestId: 'r1', approverToken: 'bad' }));
    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.INVALID_LINK)
    );
  });

  test('409 already signed → already-signed terminal', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already signed the request' } },
    });
    renderHook(() => useResolveApproval({ requestId: 'r1', approverToken: 't1' }));
    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.ALREADY_SIGNED)
    );
  });

  test('409 already rejected → already-rejected terminal', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already rejected the request' } },
    });
    renderHook(() => useResolveApproval({ requestId: 'r1', approverToken: 't1' }));
    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.ALREADY_REJECTED)
    );
  });

  test('network failure → failed state with error, retry works', async () => {
    apiClient.post.mockRejectedValueOnce(new Error('Network Error'));
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 180 } });

    const { result } = renderHook(() => useResolveApproval({ requestId: 'r1', approverToken: 't1' }));
    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.GATE);

    await act(async () => result.current.retry());
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.OTP);
  });
});
