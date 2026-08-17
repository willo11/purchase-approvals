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

describe('LandingPage (demo hub scenarios)', () => {
  test('renders the demo scenarios section with all four scenario names', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: /demo scenarios/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Full flow')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Regenerated OTP')).toBeInTheDocument();
    expect(screen.getByText('Completed + PDF')).toBeInTheDocument();
    // The seeder command is advertised right under the heading.
    expect(screen.getByText(/db:seed-scenarios/i)).toBeInTheDocument();
  });

  test('explains the regenerated OTP scenario (2 mails, latest code, generate new OTP)', () => {
    renderPage();

    expect(
      screen.getByText(/Ana has 2 OTP mails \(newest valid\): open the link and enter the LATEST code/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/"Generate new OTP"/i)).toBeInTheDocument();
  });
});