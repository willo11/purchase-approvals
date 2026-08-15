import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ApprovalLandingPage from './ApprovalLandingPage';
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

function renderLanding(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/approve" element={<ApprovalLandingPage />} />
        <Route path="/" element={<ApprovalLandingPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const VALID = '/approve?request_id=r1&approver_token=t1';

describe('ApprovalLandingPage — R1 link resolution gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApprovalFlowStore();
  });

  test('gate success → OTP entry (R1)', async () => {
    apiClient.post.mockResolvedValue({ data: { expiresInSeconds: 180 } });
    renderLanding(VALID);
    expect(await screen.findByText('Enter your code')).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/api/approvals/r1/token/t1/otp');
  });

  test('410 request completed → completed terminal screen, no OTP UI', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 410, data: { error: 'TerminalRequestError', message: 'Request r1 is already COMPLETED; no OTP flow is offered' } },
    });
    renderLanding(VALID);
    expect(await screen.findByText('Request Completed')).toBeInTheDocument();
    expect(screen.queryByText('Enter your code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('410 request already rejected → informational screen (R1 scenario)', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 410, data: { error: 'TerminalRequestError', message: 'Request r1 is already REJECTED; no OTP flow is offered' } },
    });
    renderLanding(VALID);
    expect(await screen.findByText('Request Rejected')).toBeInTheDocument();
  });

  test('409 approver already signed → already-signed screen (R1 scenario)', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already signed the request' } },
    });
    renderLanding(VALID);
    expect(await screen.findByText('Already Signed')).toBeInTheDocument();
  });

  test('403 lockout → lockout screen, no OTP UI (R1/R2)', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 403, data: { error: 'LockedOutError', message: 'Approver token is invalidated (lockout)' } },
    });
    renderLanding(VALID);
    expect(await screen.findByText('Access Locked')).toBeInTheDocument();
    expect(screen.queryByText('Enter your code')).not.toBeInTheDocument();
  });

  test('404 unknown token → invalid-link screen', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 404, data: { error: 'UnknownTokenError', message: 'Token does not resolve to this approver' } },
    });
    renderLanding(VALID);
    expect(await screen.findByText('Invalid Link')).toBeInTheDocument();
  });

  test('missing params → invalid-link screen, no API call', async () => {
    renderLanding('/approve');
    expect(await screen.findByText('Invalid Link')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  test('network failure → alert with Try again; retry then proceeds', async () => {
    apiClient.post.mockRejectedValueOnce(new Error('Network Error'));
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 180 } });

    const user = userEvent.setup();
    renderLanding(VALID);

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(useApprovalFlowStore.getState().phase).toBe(FLOW_PHASES.GATE);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Enter your code')).toBeInTheDocument();
  });
});
