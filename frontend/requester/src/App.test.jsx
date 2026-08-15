import { render, screen } from '@testing-library/react';
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

function renderApp(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        {/* Mirrors the host mount: requester owns /requester* */}
        <Route path="/requester/*" element={<App />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('requester App routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: [] });
  });

  test('mounts the list screen at the remote root', async () => {
    renderApp('/requester');
    expect(
      await screen.findByText('Purchase requests')
    ).toBeInTheDocument();
  });

  test('mounts the create screen at /new', async () => {
    renderApp('/requester/new');
    expect(
      await screen.findByText('New purchase request')
    ).toBeInTheDocument();
  });

  test('mounts the detail screen at /:id', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        id: 'r1',
        title: 'Laptops',
        description: 'Gear',
        amount: 2500,
        currency: 'USD',
        status: 'PENDING',
        createdBy: { email: 'carol@x.com', name: 'Carol' },
        approvers: [],
        createdAt: '2026-08-14T12:00:00.000Z',
      },
    });
    renderApp('/requester/r1');
    expect(await screen.findByText('Laptops')).toBeInTheDocument();
  });
});
