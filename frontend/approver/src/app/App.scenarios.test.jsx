import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { apiClient } from '@/api/client';
import { resetApprovalFlowStore } from '@/store/useApprovalFlowStore';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

// Acceptance-level scenario tests (spec approver-flow R1–R4) walking the FULL
// App through the router with mocked axios. Per-screen unit tests live next to
// each page; this suite proves the flows connect end-to-end.

const VALID_LINK = '/approve?request_id=r1&approver_token=t1';

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

function renderApp(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        {/* Mirrors the host mount: the approver owns /approve* */}
        <Route path="/approve/*" element={<App />} />
      </Routes>
    </MemoryRouter>
  );
}

async function typeCode(user, code) {
  const input = await screen.findByLabelText('6-digit code');
  await user.clear(input);
  await user.type(input, code);
  await user.click(screen.getByRole('button', { name: 'Verify code' }));
}

describe('approver flow — R1–R4 acceptance scenarios', () => {
  beforeEach(() => {
    // mockReset clears once-queues from previous tests (clearAllMocks does not).
    apiClient.get.mockReset();
    apiClient.post.mockReset();
    resetApprovalFlowStore();
  });

  test('R1+R2+R3: valid link → OTP → detail → approve without a name', async () => {
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 180 } }); // issue #7
    apiClient.post.mockResolvedValueOnce({ data: { valid: true } }); // validate #8
    apiClient.post.mockResolvedValueOnce({ data: detailFixture }); // approve #10
    apiClient.get.mockResolvedValueOnce({ data: detailFixture }); // detail #5

    const user = userEvent.setup();
    renderApp(VALID_LINK);

    // R1: gate passed → OTP entry.
    await screen.findByText('Enter your code');
    await typeCode(user, '123456');

    // R3: decision page shows the request data; approve sends NO name.
    expect(await screen.findByText('Laptops')).toBeInTheDocument();
    expect(screen.getByText('USD 2,500.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    // R4: post-action terminal.
    expect(await screen.findByText('Request Approved')).toBeInTheDocument();
    expect(screen.getByText(/approval has been recorded/i)).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/api/approvals/r1/token/t1/approve');
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
  });

  test('R3+R4: reject requires confirmation, then shows the post-action terminal', async () => {
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 180 } });
    apiClient.post.mockResolvedValueOnce({ data: { valid: true } });
    apiClient.post.mockResolvedValueOnce({ data: detailFixture }); // reject #11
    apiClient.get.mockResolvedValueOnce({ data: detailFixture });

    const user = userEvent.setup();
    renderApp(VALID_LINK);

    await screen.findByText('Enter your code');
    await typeCode(user, '123456');

    await screen.findByText('Laptops');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(apiClient.post).not.toHaveBeenCalledWith(
      '/api/approvals/r1/token/t1/reject',
      expect.anything()
    );

    await user.click(screen.getByRole('button', { name: 'Yes, reject' }));
    expect(await screen.findByText('Request Rejected')).toBeInTheDocument();
    expect(screen.getByText(/rejection has been recorded/i)).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/approvals/r1/token/t1/reject',
      { confirm: true }
    );
  });

  test('R1: a link for an already-rejected request shows an informational screen', async () => {
    apiClient.post.mockRejectedValueOnce({
      response: { status: 410, data: { error: 'TerminalRequestError', message: 'Request r1 is already REJECTED; no OTP flow is offered' } },
    });

    renderApp(VALID_LINK);

    expect(await screen.findByText('Request Rejected')).toBeInTheDocument();
    expect(screen.getByText(/has been rejected/i)).toBeInTheDocument();
    expect(screen.queryByText('Enter your code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('R1: an approver who already signed gets the already-signed screen', async () => {
    apiClient.post.mockRejectedValueOnce({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already signed the request' } },
    });

    renderApp(VALID_LINK);

    expect(await screen.findByText('Already Signed')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('R2: lockout after 3 wrong codes', async () => {
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 180 } }); // issue
    // Attempt 1 and 2 → 401 with the countdown; attempt 3 → 403 lockout.
    apiClient.post.mockRejectedValueOnce({
      response: { status: 401, data: { error: 'WrongOtpError', message: 'Incorrect code', attemptsRemaining: 2 } },
    });
    apiClient.post.mockRejectedValueOnce({
      response: { status: 401, data: { error: 'WrongOtpError', message: 'Incorrect code', attemptsRemaining: 1 } },
    });
    apiClient.post.mockRejectedValueOnce({
      response: { status: 403, data: { error: 'LockedOutError', message: 'Approver token is invalidated (lockout)' } },
    });

    const user = userEvent.setup();
    renderApp(VALID_LINK);

    await screen.findByText('Enter your code');
    await typeCode(user, '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('2 attempts remaining.');
    await typeCode(user, '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('1 attempt remaining.');
    await typeCode(user, '000000');

    expect(await screen.findByText('Access Locked')).toBeInTheDocument();
    expect(screen.queryByText('Enter your code')).not.toBeInTheDocument();
  });

  test('R2: expired OTP → generate new OTP restarts entry with a fresh window', async () => {
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 180 } }); // issue
    apiClient.post.mockRejectedValueOnce({
      response: { status: 410, data: { error: 'ExpiredOtpError', message: 'The OTP is missing or expired' } },
    });
    // Regeneration returns a different TTL — the entry must show the new one.
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 300 } }); // regenerate #9

    const user = userEvent.setup();
    renderApp(VALID_LINK);

    await screen.findByText('Enter your code');
    await typeCode(user, '123456');

    expect(await screen.findByText('Your code has expired')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate new OTP' }));

    expect(await screen.findByText('A new code has been sent.')).toBeInTheDocument();
    expect(screen.getByText('Enter your code')).toBeInTheDocument();
    // FIX 4: the countdown reflects the REGENERATED TTL (300s → 5 minutes).
    expect(screen.getByText(/It expires in 5 minutes/)).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/api/approvals/r1/token/t1/otp/regenerate');
  });

  test('R4: reloading the link after rejecting lands on the informational screen', async () => {
    // First visit: full flow to a successful rejection.
    apiClient.post.mockResolvedValueOnce({ data: { expiresInSeconds: 180 } });
    apiClient.post.mockResolvedValueOnce({ data: { valid: true } });
    apiClient.post.mockResolvedValueOnce({ data: detailFixture });
    apiClient.get.mockResolvedValueOnce({ data: detailFixture });

    const user = userEvent.setup();
    const { unmount } = renderApp(VALID_LINK);
    await screen.findByText('Enter your code');
    await typeCode(user, '123456');
    await screen.findByText('Laptops');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Yes, reject' }));
    expect(await screen.findByText('Request Rejected')).toBeInTheDocument();

    // "Reload": fresh render — the gate now returns 409 (already acted).
    unmount();
    resetApprovalFlowStore();
    apiClient.post.mockReset();
    apiClient.post.mockRejectedValueOnce({
      response: { status: 409, data: { error: 'AlreadyActedError', message: 'This approver already rejected the request' } },
    });

    renderApp(VALID_LINK);
    expect(await screen.findByText('Request Rejected')).toBeInTheDocument();
    expect(screen.getByText(/has been rejected/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
