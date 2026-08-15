import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OtpEntryPage from './OtpEntryPage';
import { apiClient } from '@/api/client';
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

function seedOtpEntry() {
  useApprovalFlowStore.getState().startFlow({ requestId: 'r1', approverToken: 't1' });
  useApprovalFlowStore.getState().enterOtpEntry({ expiresInSeconds: 180 });
}

describe('OtpEntryPage — R2 scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApprovalFlowStore();
    seedOtpEntry();
  });

  test('renders the entry card with a 6-digit input and a disabled Verify button', () => {
    render(<OtpEntryPage />);
    expect(screen.getByText('Enter your code')).toBeInTheDocument();
    const verify = screen.getByRole('button', { name: 'Verify code' });
    expect(verify).toBeDisabled();
  });

  test('correct OTP advances the flow to the decision step', async () => {
    apiClient.post.mockResolvedValue({ data: { valid: true } });
    const user = userEvent.setup();
    render(<OtpEntryPage />);

    const input = screen.getByLabelText('6-digit code');
    await user.type(input, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    await waitFor(() =>
      expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.DECISION)
    );
  });

  test('wrong code shows the API attemptsRemaining and stays on entry', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 401, data: { error: 'WrongOtpError', message: 'Incorrect code', attemptsRemaining: 2 } },
    });
    const user = userEvent.setup();
    render(<OtpEntryPage />);

    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect code. 2 attempts remaining.'
    );
    expect(screen.getByText('Enter your code')).toBeInTheDocument();
  });

  test('3rd failure locks out — flow store goes terminal locked-out', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 403, data: { error: 'LockedOutError', message: 'Approver token is invalidated (lockout)' } },
    });
    const user = userEvent.setup();
    render(<OtpEntryPage />);

    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.LOCKED_OUT)
    );
  });

  test('expired OTP offers "Generate new OTP"; regeneration restarts entry', async () => {
    apiClient.post.mockRejectedValueOnce({
      response: { status: 410, data: { error: 'ExpiredOtpError', message: 'The OTP is missing or expired' } },
    });
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 180 } });

    const user = userEvent.setup();
    render(<OtpEntryPage />);

    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    // Expired → regeneration card with a fresh 3-minute window.
    expect(await screen.findByText('Your code has expired')).toBeInTheDocument();
    expect(screen.getByText(/valid for 3 minutes/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Generate new OTP' }));

    expect(await screen.findByText('A new code has been sent.')).toBeInTheDocument();
    expect(screen.getByText('Enter your code')).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/api/approvals/r1/token/t1/otp/regenerate');
  });
});
