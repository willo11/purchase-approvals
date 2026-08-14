import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the approver placeholder page', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', { name: /approver module/i })
  ).toBeInTheDocument();
});
