import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

// The remotes are webpack Module Federation containers (runtime URL imports);
// in Jest they are mocked so the host's lazy/Suspense composition is testable.
// `virtual: true` registers the mocks without resolving the real modules,
// which only exist at webpack build time.
jest.mock('solicitante/App', () => {
  return { __esModule: true, default: () => <div>mock solicitante</div> };
}, { virtual: true });
jest.mock('aprobador/App', () => {
  return { __esModule: true, default: () => <div>mock aprobador</div> };
}, { virtual: true });

test('renders the landing page with links to both remotes', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  );

  expect(
    screen.getByRole('heading', { name: /purchase approval flow/i })
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /solicitante/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /approver/i })).toBeInTheDocument();
});

test('lazily composes the solicitante remote on /solicitante*', async () => {
  render(
    <MemoryRouter initialEntries={['/solicitante']}>
      <App />
    </MemoryRouter>
  );

  expect(await screen.findByText('mock solicitante')).toBeInTheDocument();
});

test('lazily composes the aprobador remote on /approve*', async () => {
  render(
    <MemoryRouter initialEntries={['/approve']}>
      <App />
    </MemoryRouter>
  );

  expect(await screen.findByText('mock aprobador')).toBeInTheDocument();
});
