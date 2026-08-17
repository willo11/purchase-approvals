import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders a PENDING badge with neutral classes', () => {
    const { container } = render(<StatusBadge status="PENDING">Pending</StatusBadge>);
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(container.firstChild.className).toContain('bg-secondary');
  });

  it('renders a SIGNED badge with primary (solid) classes', () => {
    const { container } = render(<StatusBadge status="SIGNED">Signed</StatusBadge>);
    expect(container.firstChild.className).toContain('bg-primary');
  });

  it('renders a REJECTED badge with destructive classes', () => {
    const { container } = render(<StatusBadge status="REJECTED">Rejected</StatusBadge>);
    expect(container.firstChild.className).toContain('bg-destructive');
  });

  it('renders a COMPLETED badge as an outline', () => {
    const { container } = render(<StatusBadge status="COMPLETED">Completed</StatusBadge>);
    expect(container.firstChild.className).toContain('text-foreground');
  });

  it('falls back to neutral for an unknown status', () => {
    const { container } = render(<StatusBadge status="WEIRD">Unknown</StatusBadge>);
    expect(container.firstChild.className).toContain('bg-secondary');
  });
});
