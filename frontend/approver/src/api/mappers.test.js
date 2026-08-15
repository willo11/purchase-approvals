import { formatAmount, formatDate, toDetailView, STATUS_LABELS } from './mappers';

describe('approver mappers', () => {
  test('STATUS_LABELS are English', () => {
    expect(STATUS_LABELS).toEqual({
      PENDING: 'Pending',
      SIGNED: 'Signed',
      REJECTED: 'Rejected',
      COMPLETED: 'Completed',
    });
  });

  test('formatAmount renders USD with two decimals', () => {
    expect(formatAmount(1234.5)).toBe('USD 1,234.50');
  });

  test('formatDate renders a UTC label and a dash for missing dates', () => {
    expect(formatDate('2026-08-14T12:00:00.000Z')).toBe('Aug 14, 2026');
    expect(formatDate(null)).toBe('—');
  });

  test('toDetailView maps RequestDetail for the decision screen (R3)', () => {
    const view = toDetailView({
      id: 'r1',
      title: 'Laptops',
      description: 'Developer gear',
      amount: 2500,
      currency: 'USD',
      status: 'PENDING',
      createdBy: { email: 'carol@x.com', name: 'Carol' },
      approvers: [],
      createdAt: '2026-08-14T12:00:00.000Z',
    });
    expect(view).toEqual({
      id: 'r1',
      title: 'Laptops',
      description: 'Developer gear',
      amountLabel: 'USD 2,500.00',
      status: 'PENDING',
      statusLabel: 'Pending',
      requester: 'Carol',
      createdLabel: 'Aug 14, 2026',
    });
  });

  test('toDetailView falls back when the requester snapshot is missing', () => {
    const view = toDetailView({ id: 'r1', title: 'X', amount: 1, currency: 'USD', status: 'PENDING' });
    expect(view.requester).toBe('—');
  });
});
