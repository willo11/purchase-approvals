import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the solicitante placeholder page', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', { name: /solicitante module/i })
  ).toBeInTheDocument();
});
