import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

// The remotes are webpack Module Federation containers (runtime URL imports);
// in Jest they are mocked so the host's lazy/Suspense composition is testable.
// `virtual: true` registers the mocks without resolving the real modules,
// which only exist at webpack build time.
jest.mock('requester/App', () => {
  return { __esModule: true, default: () => <div>mock requester</div> };
}, { virtual: true });
jest.mock('approver/App', () => {
  return { __esModule: true, default: () => <div>mock approver</div> };
}, { virtual: true });

// The /demo approver console fetches from the backend; keep it inert here.
jest.mock('axios', () => {
  const mockInstance = { get: jest.fn().mockResolvedValue({ data: [] }) };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

test('renders the demo hub on / with both entry cards in the shell', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  );

  const header = screen.getByRole('banner');
  const main = screen.getByRole('main');
  expect(within(header).getByRole('link', { name: /purchase approvals/i })).toBeInTheDocument();
  expect(within(header).getByRole('link', { name: /requester/i })).toBeInTheDocument();
  expect(within(header).getByRole('link', { name: /approver/i })).toBeInTheDocument();

  expect(
    screen.getByRole('heading', { name: /purchase approvals — demo hub/i })
  ).toBeInTheDocument();

  const requesterCard = within(main).getByRole('link', { name: /requester panel/i });
  expect(requesterCard).toHaveAttribute('href', '/requester');
  const approverCard = within(main).getByRole('link', { name: /approver console/i });
  expect(approverCard).toHaveAttribute('href', '/demo');
  expect(screen.getByText(/demo tips/i)).toBeInTheDocument();
});

test('lazily composes the requester remote on /requester*', async () => {
  render(
    <MemoryRouter initialEntries={['/requester']}>
      <App />
    </MemoryRouter>
  );

  expect(await screen.findByText('mock requester')).toBeInTheDocument();
});

test('renders the approver console on /demo', async () => {
  render(
    <MemoryRouter initialEntries={['/demo']}>
      <App />
    </MemoryRouter>
  );

  expect(
    await screen.findByRole('heading', { name: /approver console/i })
  ).toBeInTheDocument();
});

test('lazily composes the approver remote on /approve*', async () => {
  render(
    <MemoryRouter initialEntries={['/approve']}>
      <App />
    </MemoryRouter>
  );

  expect(await screen.findByText('mock approver')).toBeInTheDocument();
});