import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import RequestListScreen from './RequestListScreen';
import { apiClient } from '@/api/client';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

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

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <RequestListScreen />
    </MemoryRouter>
  );
}

describe('RequestListScreen (R1 + R5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('R1: renders 2 requests newest first with title, amount, status, date', async () => {
    apiClient.get.mockResolvedValue({ data: twoRequests });

    renderScreen();

    const rows = await screen.findAllByRole('row');
    // header row + 2 request rows
    expect(rows).toHaveLength(3);

    const firstRow = within(rows[1]);
    expect(firstRow.getByText('Newer laptop')).toBeInTheDocument();
    expect(firstRow.getByText('USD 2,500.00')).toBeInTheDocument();
    expect(firstRow.getByText('Pending')).toBeInTheDocument();
    expect(firstRow.getByText('Aug 15, 2026')).toBeInTheDocument();

    const secondRow = within(rows[2]);
    expect(secondRow.getByText('Older chair')).toBeInTheDocument();
    expect(secondRow.getByText('USD 120.50')).toBeInTheDocument();
    expect(secondRow.getByText('Rejected')).toBeInTheDocument();
    expect(secondRow.getByText('Aug 14, 2026')).toBeInTheDocument();
  });

  test('R1: shows an empty state when the backend returns no requests', async () => {
    apiClient.get.mockResolvedValue({ data: [] });

    renderScreen();

    expect(
      await screen.findByText('No purchase requests yet.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create your first request' })
    ).toBeInTheDocument();
  });

  test('R5: surfaces a 500 error and stays usable with a retry', async () => {
    apiClient.get.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Internal', message: 'Boom' } },
    });
    apiClient.get.mockResolvedValueOnce({ data: twoRequests });

    renderScreen();

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();

    // Screen remains usable: retry refetches and renders the list.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByText('Newer laptop')).toBeInTheDocument()
    );
  });
});
