import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OtpInput from './OtpInput';

function ControlledOtpInput() {
  const [value, setValue] = useState('');
  return <OtpInput value={value} onChange={setValue} />;
}

describe('OtpInput — 6-digit numeric input (R2)', () => {
  test('renders a labeled 6-digit numeric input', () => {
    render(<OtpInput value="" onChange={() => {}} />);
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
    expect(screen.getByLabelText('6-digit code')).toHaveAttribute('inputMode', 'numeric');
  });

  test('strips non-digit characters and caps at 6 digits', async () => {
    const user = userEvent.setup();
    render(<ControlledOtpInput />);
    const input = screen.getByLabelText('6-digit code');

    await user.type(input, '12ab34c56');

    // Only the digits survive, in order, capped at 6.
    expect(input).toHaveValue('123456');
    expect(input).toHaveAttribute('maxLength', '6');
  });
});
