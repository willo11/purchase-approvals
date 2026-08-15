import { act, renderHook, waitFor } from '@testing-library/react';
import { apiClient } from '@/api/client';
import { useValidateOtp } from './useValidateOtp';
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
  useApprovalFlowStore.getState().enterOtpEntry({ expiresInSeconds: 180 });
}

describe('useValidateOtp — OTP entry (R2, task 7.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApprovalFlowStore();
    seedStore();
  });

  test('correct code → decision step (advances to request detail)', async () => {
    apiClient.post.mockResolvedValue({ data: { valid: true } });
    const { result } = renderHook(() => useValidateOtp());
    await act(async () => result.current.submit('123456'));
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.DECISION);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/approvals/r1/token/t1/otp/validate',
      { code: '123456' }
    );
  });

  test('wrong code → error surfaced with the API attemptsRemaining, stays on entry', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 401, data: { error: 'WrongOtpError', message: 'Incorrect code', attemptsRemaining: 2 } },
    });
    const { result } = renderHook(() => useValidateOtp());
    await act(async () => result.current.submit('000000'));
    expect(result.current.error.status).toBe(401);
    expect(result.current.error.attemptsRemaining).toBe(2);
    expect(useApprovalFlowStore.getState().attemptsRemaining).toBe(2);
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.OTP);
  });

  test('3rd wrong code → 403 lockout terminal', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 403, data: { error: 'LockedOutError', message: 'Approver token is invalidated (lockout)' } },
    });
    const { result } = renderHook(() => useValidateOtp());
    await act(async () => result.current.submit('000000'));
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.TERMINAL);
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.LOCKED_OUT);
  });

  test('410 ExpiredOtpError → expired state, regenerate restarts entry with a FRESH window (R2)', async () => {
    apiClient.post.mockRejectedValueOnce({
      response: { status: 410, data: { error: 'ExpiredOtpError', message: 'The OTP is missing or expired' } },
    });
    // Regeneration returns a DIFFERENT TTL than the original 180s — the store
    // must pick it up so the countdown reflects the new window.
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 300 } });

    const { result } = renderHook(() => useValidateOtp());
    await act(async () => result.current.submit('123456'));
    expect(result.current.expired).toBe(true);
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.OTP);

    const seconds = await act(async () => result.current.regenerate());
    expect(seconds).toBe(300);
    expect(useApprovalFlowStore.getState().expiresInSeconds).toBe(300);
    expect(result.current.expired).toBe(false);
    expect(apiClient.post).toHaveBeenCalledWith('/api/approvals/r1/token/t1/otp/regenerate');
  });

  test('410 TerminalRequestError (race: request completed while entering) → completed terminal', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 410, data: { error: 'TerminalRequestError', message: 'Request r1 is already COMPLETED; no OTP flow is offered' } },
    });
    const { result } = renderHook(() => useValidateOtp());
    await act(async () => result.current.submit('123456'));
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.COMPLETED);
  });

  test('409 already acted while entering → already-signed terminal', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already signed the request' } },
    });
    const { result } = renderHook(() => useValidateOtp());
    await act(async () => result.current.submit('123456'));
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.ALREADY_SIGNED);
  });

  test('regenerate failure on a locked token → locked-out terminal', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 403, data: { error: 'LockedOutError', message: 'Approver token is invalidated (lockout)' } },
    });
    const { result } = renderHook(() => useValidateOtp());
    const seconds = await act(async () => result.current.regenerate());
    expect(seconds).toBeNull();
    expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.LOCKED_OUT);
  });
});
