import { render, screen } from '@testing-library/react';
import OtpLockedOutPage from './OtpLockedOutPage';

describe('OtpLockedOutPage — R2 lockout screen', () => {
  test('shows the lockout message and blocks any action', () => {
    render(<OtpLockedOutPage />);
    expect(screen.getByText('Access Locked')).toBeInTheDocument();
    expect(screen.getByText(/Too many incorrect codes/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
