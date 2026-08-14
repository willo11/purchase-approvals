import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the requester placeholder page', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', { name: /requester module/i })
  ).toBeInTheDocument();
});
