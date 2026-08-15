import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RequestDetailPage from './RequestDetailPage';
import { apiClient } from '@/api/client';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

const completedDetail = {
  id: 'r1',
  title: 'New laptops',
  description: 'Gear for the team',
  amount: 2500,
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

const pendingDetail = {
  ...completedDetail,
  status: 'PENDING',
  evidenceKey: undefined,
};

const rejectedDetail = {
  ...completedDetail,
  status: 'REJECTED',
  evidenceKey: undefined,
  approvers: [
    { email: 'alice@x.com', name: 'Alice', status: 'SIGNED', signedAt: '2026-08-15T09:00:00.000Z' },
    { email: 'bob@x.com', name: 'Bob', status: 'REJECTED', rejectedAt: '2026-08-15T11:30:00.000Z' },
    { email: 'dana@x.com', name: 'Dana', status: 'PENDING' },
  ],
};

function renderScreen(detail) {
  apiClient.get.mockResolvedValue({ data: detail });
  return render(
    <MemoryRouter initialEntries={['/r1']}>
      <Routes>
        <Route path="/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RequestDetailPage (R3 + R4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();
  });

  test('R3: renders metadata and per-approver status table (2 SIGNED + 1 PENDING)', async () => {
    renderScreen(completedDetail);

    expect(await screen.findByText('New laptops')).toBeInTheDocument();
    expect(screen.getByText('Gear for the team')).toBeInTheDocument();
    expect(screen.getByText('USD 2,500.00')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    // header + 3 approver rows
    expect(rows).toHaveLength(4);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getAllByText('Signed')).toHaveLength(2);
    expect(screen.getByText('Dana')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getAllByText('Aug 15, 2026')).toHaveLength(2);
  });

  test('R4: shows Download PDF only when COMPLETED and downloads the blob', async () => {
    renderScreen(completedDetail);

    const button = await screen.findByRole('button', { name: 'Download PDF' });
    expect(button).toBeInTheDocument();

    apiClient.get.mockClear();
    apiClient.get.mockResolvedValueOnce({ data: new Blob(['pdf']) });

    await userEvent.click(button);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/purchase-requests/r1/evidence.pdf', {
        responseType: 'blob',
      });
    });
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });

  test('R3: REJECTED approver row renders with its rejection date', async () => {
    renderScreen(rejectedDetail);

    await screen.findByText('New laptops');

    expect(screen.getByText('Bob')).toBeInTheDocument();
    // Two "Rejected" badges: the global status badge + Bob's approver row.
    expect(screen.getAllByText('Rejected')).toHaveLength(2);
    // Rejection date: 2026-08-15T11:30 UTC → "Aug 15, 2026".
    expect(screen.getAllByText('Aug 15, 2026')).toHaveLength(2); // Alice signed + Bob rejected
    // PENDING approver shows a dash, not a date.
    expect(screen.getByText('Dana')).toBeInTheDocument();
    // No Download PDF for a REJECTED (non-COMPLETED) request.
    expect(
      screen.queryByRole('button', { name: /Download PDF/i })
    ).not.toBeInTheDocument();
  });

  test('R4: PDF download failure is surfaced and the screen stays usable', async () => {
    renderScreen(completedDetail);

    const button = await screen.findByRole('button', { name: 'Download PDF' });

    apiClient.get.mockClear();
    apiClient.get.mockRejectedValueOnce({
      response: {
        status: 404,
        data: { error: 'NotFound', message: 'Evidence not found' },
      },
    });

    await userEvent.click(button);

    expect(
      await screen.findByText('Evidence not found')
    ).toBeInTheDocument();
    // Screen stays usable: metadata still rendered and button still clickable.
    expect(screen.getByText('New laptops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  });

  test('R4: no Download PDF button when the request is not COMPLETED', async () => {
    renderScreen(pendingDetail);

    await screen.findByText('New laptops');
    expect(
      screen.queryByRole('button', { name: /Download PDF/i })
    ).not.toBeInTheDocument();
  });

  test('R5: detail fetch failure is surfaced and stays usable', async () => {
    apiClient.get.mockRejectedValue({
      response: { status: 404, data: { error: 'NotFound', message: 'Unknown request' } },
    });

    render(
      <MemoryRouter initialEntries={['/nope']}>
        <Routes>
          <Route path="/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('alert')
    ).toHaveTextContent('Unknown request');
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();
  });
});
