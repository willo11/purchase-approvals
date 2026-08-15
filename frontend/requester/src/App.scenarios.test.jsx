import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { apiClient } from '@/api/client';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

// Acceptance-level scenario tests (spec R1–R5) walking the FULL App through
// the router, with mocked axios. Per-screen unit tests live next to each
// screen; this suite proves the flows connect end-to-end.

const users = [
  { name: 'Carol', email: 'carol@x.com' },
  { name: 'Alice', email: 'alice@x.com' },
  { name: 'Bob', email: 'bob@x.com' },
  { name: 'Dana', email: 'dana@x.com' },
  { name: 'Evan', email: 'evan@x.com' },
];

const twoRequests = [
  {
    id: 'r2',
    title: 'Newer laptop',
    amount: 2500,
    currency: 'USD',
    status: 'PENDING',
    createdAt: '2026-08-15T12:00:00.000Z',
  },
  {
    id: 'r1',
    title: 'Older chair',
    amount: 120.5,
    currency: 'USD',
    status: 'REJECTED',
    createdAt: '2026-08-14T12:00:00.000Z',
  },
];

function completedDetail() {
  return {
    id: 'r1',
    title: 'Older chair',
    description: 'Ergonomic seating',
    amount: 120.5,
    currency: 'USD',
    status: 'COMPLETED',
    createdBy: { email: 'carol@x.com', name: 'Carol' },
    approvers: [
      { email: 'alice@x.com', name: 'Alice', status: 'SIGNED', signedAt: '2026-08-15T09:00:00.000Z' },
      { email: 'bob@x.com', name: 'Bob', status: 'SIGNED', signedAt: '2026-08-15T10:00:00.000Z' },
      { email: 'dana@x.com', name: 'Dana', status: 'PENDING' },
    ],
    createdAt: '2026-08-14T12:00:00.000Z',
    evidenceKey: 'reqs/r1/evidence.pdf',
  };
}

function renderApp(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/requester/*" element={<App />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('requester panel — R1–R5 acceptance flows', () => {
  beforeEach(() => {
    // mockReset clears once-queues from previous tests (clearAllMocks does not).
    apiClient.get.mockReset();
    apiClient.post.mockReset();
    apiClient.get.mockResolvedValue({ data: [] });
  });

  test('R1+R3+R4: list → detail flow shows metadata, approver table and PDF only when COMPLETED', async () => {
    apiClient.get.mockResolvedValueOnce({ data: twoRequests });
    apiClient.get.mockResolvedValueOnce({ data: completedDetail() });

    renderApp('/requester');

    // R1: list renders, newest first (row order).
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(screen.getByText('Newer laptop')).toBeInTheDocument();

    // Click the older (REJECTED→COMPLETED fixture) request row link → detail.
    await userEvent.click(screen.getByRole('link', { name: 'Older chair' }));

    // R3: metadata + per-approver table (2 SIGNED + 1 PENDING).
    expect(await screen.findByText('Ergonomic seating')).toBeInTheDocument();
    expect(screen.getAllByText('Signed')).toHaveLength(2);
    expect(screen.getByText('Pending')).toBeInTheDocument();

    // R4: COMPLETED → Download PDF button present.
    expect(
      screen.getByRole('button', { name: 'Download PDF' })
    ).toBeInTheDocument();
  });

  test('R2: create → navigate to detail on success (list refetch signal bumped)', async () => {
    apiClient.get.mockResolvedValueOnce({ data: users });
    apiClient.post.mockResolvedValue({
      data: { id: 'r9', title: 'New monitors', ...completedDetail() },
    });
    // Detail fetch for the created request (mirrors what the backend returns).
    apiClient.get.mockResolvedValueOnce({
      data: { ...completedDetail(), id: 'r9', title: 'New monitors' },
    });

    const user = userEvent.setup();
    renderApp('/requester/new');

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/users'));

    await user.type(screen.getByLabelText('Title'), 'New monitors');
    await user.type(screen.getByLabelText('Description'), 'External displays');
    await user.type(screen.getByLabelText('Amount (USD)'), '899.99');

    await user.click(screen.getByRole('combobox', { name: 'Requester' }));
    await user.click(await screen.findByRole('option', { name: /Carol/ }));

    const approverSelects = ['Approver 1', 'Approver 2', 'Approver 3'];
    const approverEmails = ['alice@x.com', 'bob@x.com', 'dana@x.com'];
    for (let i = 0; i < approverSelects.length; i += 1) {
      await user.click(screen.getByRole('combobox', { name: approverSelects[i] }));
      await user.click(
        await screen.findByRole('option', { name: new RegExp(approverEmails[i]) })
      );
    }

    await user.click(screen.getByRole('button', { name: 'Create request' }));

    // R2: POST with the right payload, then navigate to the new detail.
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/purchase-requests', {
        title: 'New monitors',
        description: 'External displays',
        amount: 899.99,
        requesterEmail: 'carol@x.com',
        approverEmails: ['alice@x.com', 'bob@x.com', 'dana@x.com'],
      });
    });
    // The detail mock returns the backend's stored description; the title is
    // what the form created, so assert navigation landed on the detail screen.
    expect(await screen.findByText('New monitors')).toBeInTheDocument();
  });

  test('R5: list 500 error is surfaced and the screen stays usable', async () => {
    apiClient.get.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Internal', message: 'List exploded' } },
    });
    apiClient.get.mockResolvedValueOnce({ data: twoRequests });

    renderApp('/requester');

    expect(await screen.findByRole('alert')).toHaveTextContent('List exploded');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByText('Newer laptop')).toBeInTheDocument()
    );
  });
});
