import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from './LandingPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  );
}

describe('LandingPage (demo hub tips)', () => {
  test('walks through the full demo flow without claiming seeded states', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: /demo tips/i })
    ).toBeInTheDocument();
    // The hub advertises the run-it-yourself flow, not seeded scenarios.
    expect(screen.getByText(/How to run the demo/i)).toBeInTheDocument();
    expect(screen.getByText(/pnpm -C backend run db:seed/i)).toBeInTheDocument();
    expect(screen.getByText(/create a request in the \/requester panel/i)).toBeInTheDocument();
    expect(screen.getByText(/open its approval link from \/mock-mail/i)).toBeInTheDocument();
    expect(screen.getByText(/enter the OTP, approve ×3/i)).toBeInTheDocument();
    expect(screen.getByText(/Download PDF from the completed request/i)).toBeInTheDocument();
  });

  test('keeps the inbox and ports tips for navigating the local demo', () => {
    renderPage();

    expect(
      screen.getByText(/http:\/\/localhost:4000\/dev\/mock-mail/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Host :3000 · Requester :3001 · Approver :3002 · Backend :4000/i)).toBeInTheDocument();
  });
});
