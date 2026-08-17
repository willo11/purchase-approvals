import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoPage from './DemoPage';
import { apiClient } from '@/api/client';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

const summaries = [
  {
    id: 'req-1',
    title: 'Replace laptops',
    amount: 4500,
    currency: 'USD',
    status: 'PENDING',
    createdAt: '2026-08-14T00:00:00.000Z',
  },
  {
    id: 'req-2',
    title: 'Office chairs',
    amount: 1200,
    currency: 'USD',
    status: 'COMPLETED',
    createdAt: '2026-08-14T00:01:00.000Z',
  },
];

const detail = {
  id: 'req-1',
  title: 'Replace laptops',
  description: 'Swap 3 dev laptops',
  amount: 4500,
  currency: 'USD',
  status: 'PENDING',
  createdBy: { email: 'ruth@example.com', name: 'Ruth' },
  approvers: [
    { email: 'ana@example.com', name: 'Ana', status: 'PENDING' },
    { email: 'sven@example.com', name: 'Sven', status: 'PENDING' },
    { email: 'luca@example.com', name: 'Luca', status: 'PENDING' },
  ],
  createdAt: '2026-08-14T00:00:00.000Z',
};

const mails = [
  {
    id: 'mail-1',
    to: 'ana@example.com',
    type: 'APPROVAL_LINK',
    subject: 'Approval needed',
    body: 'Please approve.',
    link: 'http://localhost:3000/approve?request_id=req-1&approver_token=token-ana',
    createdAt: '2026-08-14T00:00:05.000Z',
  },
];

// jsdom does not implement navigation — replace window.location so the page
// can "navigate" and the tests can assert where it went. `origin` mirrors the
// real console origin the mail links must match (APPROVER_BASE_URL=:3000).
const realLocation = window.location;

beforeEach(() => {
  jest.clearAllMocks();
  delete window.location;
  window.location = { href: '', origin: 'http://localhost:3000' };
});

afterEach(() => {
  window.location = realLocation;
});

function renderPage() {
  return render(<DemoPage />);
}

describe('DemoPage (approver console)', () => {
  test('renders request cards with title, amount and global status', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/purchase-requests') return Promise.resolve({ data: summaries });
      return Promise.resolve({ data: detail });
    });

    renderPage();

    expect(
      await screen.findByRole('heading', { name: /approver console/i })
    ).toBeInTheDocument();
    expect(await screen.findByText('Replace laptops')).toBeInTheDocument();
    expect(screen.getByText('USD 4,500.00')).toBeInTheDocument();
    expect(screen.getByText('Office chairs')).toBeInTheDocument();
    expect(screen.getByText('USD 1,200.00')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  test('shows the empty state when there are no requests', async () => {
    apiClient.get.mockResolvedValue({ data: [] });

    renderPage();

    expect(
      await screen.findByText(/No requests yet — create one in the requester panel/i)
    ).toBeInTheDocument();
  });

  test('expands a request into its 3 approver cards', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/purchase-requests') return Promise.resolve({ data: summaries });
      if (url === '/api/purchase-requests/req-1') return Promise.resolve({ data: detail });
      return Promise.resolve({ data: mails });
    });
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByText('Replace laptops'));

    expect(await screen.findByText(/Approvers for "Replace laptops"/i)).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('sven@example.com')).toBeInTheDocument();
    expect(screen.getByText('luca@example.com')).toBeInTheDocument();
  });

  test('clicking an approver navigates to the REAL token-gated approval link', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/purchase-requests') return Promise.resolve({ data: summaries });
      if (url === '/api/purchase-requests/req-1') return Promise.resolve({ data: detail });
      if (url === '/mock-mail') return Promise.resolve({ data: mails });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByText('Replace laptops'));
    await user.click(await screen.findByText('ana@example.com'));

    await waitFor(() => {
      expect(window.location.href).toBe(
        'http://localhost:3000/approve?request_id=req-1&approver_token=token-ana'
      );
    });
    // The console always goes through the gate: the link must carry
    // request_id + approver_token on /approve.
    expect(window.location.href).toMatch(/\/approve\?request_id=req-1&approver_token=/);
  });

  test('shows a friendly error when no approval link exists for that approver', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/purchase-requests') return Promise.resolve({ data: summaries });
      if (url === '/api/purchase-requests/req-1') return Promise.resolve({ data: detail });
      if (url === '/mock-mail') return Promise.resolve({ data: [] }); // no mails at all
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByText('Replace laptops'));
    await user.click(await screen.findByText('sven@example.com'));

    expect(
      await screen.findByRole('alert')
    ).toHaveTextContent(/No approval link found for Sven \(sven@example\.com\)/i);
    // The inbox hint derives from API_BASE_URL (truthful for any origin).
    expect(screen.getByRole('alert')).toHaveTextContent(
      'http://localhost:4000/dev/mock-mail?to=sven%40example.com'
    );
    expect(window.location.href).toBe('');
  });

  test('refuses to navigate when the mailed link points at a DIFFERENT origin (APPROVER_BASE_URL unset)', async () => {
    // TokenIssuer default: links built from http://localhost:4000 (the backend).
    const backendMails = [
      {
        id: 'mail-1',
        to: 'ana@example.com',
        type: 'APPROVAL_LINK',
        subject: 'Approval needed',
        body: 'Please approve.',
        link: 'http://localhost:4000/approve?request_id=req-1&approver_token=token-ana',
        createdAt: '2026-08-14T00:00:05.000Z',
      },
    ];
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/purchase-requests') return Promise.resolve({ data: summaries });
      if (url === '/api/purchase-requests/req-1') return Promise.resolve({ data: detail });
      if (url === '/mock-mail') return Promise.resolve({ data: backendMails });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByText('Replace laptops'));
    await user.click(await screen.findByText('ana@example.com'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/APPROVER_BASE_URL=http:\/\/localhost:3000/);
    expect(alert).toHaveTextContent(/restart the backend/);
    // No navigation happened.
    expect(window.location.href).toBe('');
  });

  test('surfaces a fetch error on the requests list with a retry', async () => {
    apiClient.get.mockRejectedValueOnce({
      response: { status: 500, data: { message: 'Backend exploded' } },
    });
    apiClient.get.mockResolvedValueOnce({ data: summaries });
    const user = userEvent.setup();

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Backend exploded');

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Replace laptops')).toBeInTheDocument();
  });
});