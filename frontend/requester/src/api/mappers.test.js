import {
  STATUS_LABELS,
  formatAmount,
  formatDate,
  toApproverView,
  toDetailView,
  toSummaryView,
  toUserOption,
} from './mappers';

describe('mappers (DTO → component shape)', () => {
  test('STATUS_LABELS are English UI labels', () => {
    expect(STATUS_LABELS).toEqual({
      PENDING: 'Pending',
      SIGNED: 'Signed',
      REJECTED: 'Rejected',
      COMPLETED: 'Completed',
    });
  });

  test('formatAmount renders USD with 2 decimals', () => {
    expect(formatAmount(1234.5)).toBe('USD 1,234.50');
    expect(formatAmount(9)).toBe('USD 9.00');
  });

  test('formatDate renders a UTC date label', () => {
    expect(formatDate('2026-08-14T12:00:00.000Z')).toBe('Aug 14, 2026');
    expect(formatDate(undefined)).toBe('—');
  });

  test('toSummaryView maps a RequestSummary', () => {
    const view = toSummaryView({
      id: 'r1',
      title: 'Laptops',
      amount: 2500,
      currency: 'USD',
      status: 'PENDING',
      createdAt: '2026-08-14T12:00:00.000Z',
    });
    expect(view).toMatchObject({
      id: 'r1',
      title: 'Laptops',
      amountLabel: 'USD 2,500.00',
      status: 'PENDING',
      statusLabel: 'Pending',
      createdLabel: 'Aug 14, 2026',
    });
  });

  test('toApproverView includes action date for signed/rejected', () => {
    const signed = toApproverView({
      email: 'a@x.com',
      name: 'Alice',
      status: 'SIGNED',
      signedAt: '2026-08-14T12:00:00.000Z',
    });
    expect(signed).toMatchObject({
      status: 'SIGNED',
      statusLabel: 'Signed',
      actionLabel: 'Aug 14, 2026',
    });

    const pending = toApproverView({
      email: 'b@x.com',
      name: 'Bob',
      status: 'PENDING',
    });
    expect(pending.actionLabel).toBe('—');
  });

  test('toDetailView maps approvers and metadata', () => {
    const view = toDetailView({
      id: 'r1',
      title: 'Laptops',
      description: 'New gear',
      amount: 2500,
      currency: 'USD',
      status: 'COMPLETED',
      createdBy: { email: 'carol@x.com', name: 'Carol' },
      approvers: [
        { email: 'a@x.com', name: 'Alice', status: 'SIGNED' },
        { email: 'b@x.com', name: 'Bob', status: 'REJECTED' },
        { email: 'c@x.com', name: 'Ced', status: 'PENDING' },
      ],
      createdAt: '2026-08-14T12:00:00.000Z',
      evidenceKey: 'reqs/r1/evidence.pdf',
    });
    expect(view.statusLabel).toBe('Completed');
    expect(view.requester).toEqual({ email: 'carol@x.com', name: 'Carol' });
    expect(view.approvers).toHaveLength(3);
    expect(view.approvers[1].statusLabel).toBe('Rejected');
    expect(view.evidenceKey).toBe('reqs/r1/evidence.pdf');
  });

  test('toUserOption produces { value, label } for selects', () => {
    expect(toUserOption({ name: 'Carol', email: 'carol@x.com' })).toEqual({
      value: 'carol@x.com',
      label: 'Carol (carol@x.com)',
    });
  });
});
