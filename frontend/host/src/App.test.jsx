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

test('renders the landing page inside the shell with nav links to both remotes', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  );

  const header = screen.getByRole('banner');
  expect(within(header).getByRole('link', { name: /purchase approvals/i })).toBeInTheDocument();
  expect(within(header).getByRole('link', { name: /requester/i })).toBeInTheDocument();
  expect(within(header).getByRole('link', { name: /approver/i })).toBeInTheDocument();

  expect(
    screen.getByRole('heading', { name: /purchase approval flow/i })
  ).toBeInTheDocument();
});

test('lazily composes the requester remote on /requester*', async () => {
  render(
    <MemoryRouter initialEntries={['/requester']}>
      <App />
    </MemoryRouter>
  );

  expect(await screen.findByText('mock requester')).toBeInTheDocument();
});

test('lazily composes the approver remote on /approve*', async () => {
  render(
    <MemoryRouter initialEntries={['/approve']}>
      <App />
    </MemoryRouter>
  );

  expect(await screen.findByText('mock approver')).toBeInTheDocument();
});
