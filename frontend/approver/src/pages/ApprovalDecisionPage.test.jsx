import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApprovalDecisionPage from './ApprovalDecisionPage';
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

const detailFixture = {
  id: 'r1',
  title: 'Laptops',
  description: 'Developer gear for the team',
  amount: 2500,
  currency: 'USD',
  status: 'PENDING',
  createdBy: { email: 'carol@x.com', name: 'Carol' },
  approvers: [
    { email: 'alice@x.com', name: 'Alice', status: 'SIGNED', signedAt: '2026-08-15T09:00:00.000Z' },
    { email: 'bob@x.com', name: 'Bob', status: 'PENDING' },
  ],
  createdAt: '2026-08-14T12:00:00.000Z',
};

function seedDecision() {
  useApprovalFlowStore.getState().startFlow({ requestId: 'r1', approverToken: 't1' });
  useApprovalFlowStore.getState().enterDecision();
}

describe('ApprovalDecisionPage — R3 scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApprovalFlowStore();
    seedDecision();
    apiClient.get.mockResolvedValue({ data: detailFixture });
  });

  test('shows title, description, amount and requester', async () => {
    render(<ApprovalDecisionPage />);
    expect(await screen.findByText('Laptops')).toBeInTheDocument();
    expect(screen.getByText('Developer gear for the team')).toBeInTheDocument();
    expect(screen.getByText('USD 2,500.00')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/api/purchase-requests/r1');
  });

  test('approve without entering a name → approved terminal (R3 scenario)', async () => {
    apiClient.post.mockResolvedValue({ data: { ...detailFixture, status: 'PENDING' } });
    const user = userEvent.setup();
    render(<ApprovalDecisionPage />);

    await screen.findByText('Laptops');
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.APPROVED)
    );
    expect(apiClient.post).toHaveBeenCalledWith('/api/approvals/r1/token/t1/approve');
    // No name ever requested (R3).
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
  });

  test('reject requires confirmation before the { confirm: true } call (R3)', async () => {
    apiClient.post.mockResolvedValue({ data: { ...detailFixture, status: 'REJECTED' } });
    const user = userEvent.setup();
    render(<ApprovalDecisionPage />);

    await screen.findByText('Laptops');

    // Clicking Reject alone must NOT fire the API call.
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(apiClient.post).not.toHaveBeenCalled();

    // Confirm → the POST carries { confirm: true } and the flow goes terminal.
    await user.click(screen.getByRole('button', { name: 'Yes, reject' }));
    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.REJECTED)
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/approvals/r1/token/t1/reject',
      { confirm: true }
    );
  });

  test('409 already signed (post-action terminality) → terminal screen', async () => {
    apiClient.post.mockRejectedValue({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already signed the request' } },
    });
    const user = userEvent.setup();
    render(<ApprovalDecisionPage />);

    await screen.findByText('Laptops');
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.ALREADY_SIGNED)
    );
  });

  test('detail fetch failure is surfaced and the screen stays usable', async () => {
    apiClient.get.mockReset();
    apiClient.get.mockRejectedValueOnce({
      response: { status: 404, data: { error: 'UnknownRequestError', message: 'Request r1 not found' } },
    });
    apiClient.get.mockResolvedValueOnce({ data: detailFixture });

    const user = userEvent.setup();
    render(<ApprovalDecisionPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Request r1 not found');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Laptops')).toBeInTheDocument();
  });

  test('transient action error → buttons disabled → Try again → buttons enabled → action succeeds', async () => {
    // Approve fails once with a transient network error, then succeeds.
    apiClient.post.mockRejectedValueOnce(new Error('Network Error'));
    apiClient.post.mockResolvedValueOnce({ data: { ...detailFixture, status: 'PENDING' } });

    const user = userEvent.setup();
    render(<ApprovalDecisionPage />);
    await screen.findByText('Laptops');

    // Transient failure: error shown, Approve/Reject disabled (no dead end).
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    // Try again clears the transient error and re-enables the actions.
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();

    // The retried action succeeds → terminal screen.
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(useApprovalFlowStore.getState().terminalVariant).toBe(TERMINAL_VARIANTS.APPROVED)
    );
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });
});
